"""Run from the repository root: uvicorn backend.main:app --reload."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
import logging
import math
from pathlib import Path
import re
from threading import Lock
from time import monotonic
from typing import Literal

from dateutil.relativedelta import relativedelta
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import pandas as pd
from pydantic import BaseModel
import yfinance as yf
from yfinance.exceptions import YFPricesMissingError, YFRateLimitError, YFTzMissingError


logger = logging.getLogger(__name__)
INTERVALS = ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo")
PERIODS = ("1d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max")
INTRADAY = frozenset(("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"))
CACHE_TTL_SECONDS = 120
CACHE_MAX_ENTRIES = 32


class Bar(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    endTime: int | None = None
    complete: bool | None = None
    session: str | None = None


class DateRange(BaseModel):
    start: str
    end: str


class MarketData(BaseModel):
    ticker: str
    name: str
    currency: str | None
    exchange: str | None
    exchangeTimezone: str = "UTC"
    interval: str
    source: Literal["yfinance"] = "yfinance"
    adjusted: Literal[True] = True
    bars: list[Bar]
    fetchedAt: str
    range: DateRange
    warnings: list[str]
    extendedHours: bool = False


@dataclass(frozen=True)
class DataRequest:
    ticker: str
    interval: str
    period: str | None
    start: date | None
    end: date | None
    extended_hours: bool = False


_cache: OrderedDict[DataRequest, tuple[float, MarketData]] = OrderedDict()
_cache_lock = Lock()


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


def _parse_date(value: str, field: str) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise HTTPException(400, f"{field} must be a date in YYYY-MM-DD format.")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(400, f"{field} must be a valid calendar date.") from exc


def _period_start(period: str, today: date) -> date:
    if period == "ytd":
        return today.replace(month=1, day=1)
    if period == "max":
        return date(1900, 1, 1)
    count, unit = re.fullmatch(r"(\d+)(d|mo|y)", period).groups()
    return today - relativedelta(**{{"d": "days", "mo": "months", "y": "years"}[unit]: int(count)})


def validate_request(
    ticker: str,
    interval: str,
    period: str | None,
    start: str | None,
    end: str | None,
) -> DataRequest:
    ticker = ticker.strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=_-]{0,31}", ticker):
        raise HTTPException(400, "Enter one valid Yahoo Finance ticker, such as AAPL, BTC-USD, ^GSPC, or EURUSD=X.")
    if interval not in INTERVALS:
        raise HTTPException(400, f"Unsupported interval. Choose one of: {', '.join(INTERVALS)}.")
    if (start is None) != (end is None):
        raise HTTPException(400, "Supply both start and end dates, or use a period.")
    if start is not None and period is not None:
        raise HTTPException(400, "Use either a period or start/end dates, not both.")

    today = utc_today()
    start_date = _parse_date(start, "start") if start is not None else None
    end_date = _parse_date(end, "end") if end is not None else None
    if start_date is not None:
        if start_date >= end_date:
            raise HTTPException(400, "The start date must be before the exclusive end date.")
        if start_date > today or end_date > today + timedelta(days=1):
            raise HTTPException(400, "Historical dates cannot be in the future (end may be tomorrow because it is exclusive).")
        requested_start, requested_end = start_date, end_date
    else:
        if period is None:
            period = "5d" if interval == "1m" else "1mo" if interval in INTRADAY - {"1h", "60m"} else "1y"
        if period not in PERIODS:
            raise HTTPException(400, f"Unsupported period. Choose one of: {', '.join(PERIODS)}.")
        requested_start, requested_end = _period_start(period, today), today

    if interval in INTRADAY:
        if interval == "1m" and (requested_end - requested_start).days > 7:
            raise HTTPException(400, "Yahoo Finance one-minute history is limited to a 7-day window per request. Choose 1d, 5d, 7d, or a shorter date range.")
        retention_days = 30 if interval == "1m" else 730 if interval in {"1h", "60m"} else 60
        if requested_start < today - timedelta(days=retention_days):
            raise HTTPException(400, f"Yahoo Finance limits {interval} history to the last {retention_days} days. Choose a shorter period or more recent start date.")
    return DataRequest(ticker, interval, period, start_date, end_date)


def clean_bars(frame: pd.DataFrame, interval: str) -> tuple[list[Bar], list[str]]:
    """Reject broken candles and keep the last occurrence of duplicate timestamps."""
    if not {"Open", "High", "Low", "Close"}.issubset(frame.columns):
        raise HTTPException(502, "Yahoo Finance returned an unexpected price format. Please try again.")
    cleaned: dict[int, Bar] = {}
    dropped = 0
    duplicates = 0
    missing_volume = 0
    for stamp, row in frame.iterrows():
        try:
            values = [float(row[field]) for field in ("Open", "High", "Low", "Close")]
            opened, high, low, close = values
            if not all(math.isfinite(value) and value > 0 for value in values):
                dropped += 1
                continue
            if high < max(opened, low, close) or low > min(opened, high, close):
                dropped += 1
                continue
            timestamp = pd.Timestamp(stamp)
            if pd.isna(timestamp):
                dropped += 1
                continue
            # Daily candles describe exchange calendar dates. Midnight UTC keeps
            # those labels stable in charts regardless of the browser timezone.
            if interval not in INTRADAY:
                timestamp = pd.Timestamp(timestamp.date(), tz="UTC")
            elif timestamp.tzinfo is None:
                timestamp = timestamp.tz_localize("UTC")
            time = int(timestamp.timestamp())
            volume = float(row.get("Volume", 0))
            if not math.isfinite(volume) or volume < 0:
                volume = 0
                missing_volume += 1
        except (ValueError, TypeError, OverflowError):
            dropped += 1
            continue
        duplicates += int(time in cleaned)
        cleaned[time] = Bar(time=time, open=opened, high=high, low=low, close=close, volume=volume)
    warnings: list[str] = []
    if dropped:
        warnings.append(f"Removed {dropped} incomplete or invalid price bar(s) from Yahoo Finance.")
    if duplicates:
        warnings.append(f"Removed {duplicates} duplicate timestamp(s).")
    if missing_volume:
        warnings.append(f"Volume was unavailable for {missing_volume} bar(s) and is shown as zero.")
    return [cleaned[stamp] for stamp in sorted(cleaned)], warnings


def _load_market_data(request: DataRequest, live: bool = False) -> MarketData:
    now = monotonic()
    with _cache_lock:
        cached = _cache.get(request)
        if not live and cached is not None and now - cached[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(request)
            return cached[1]

    try:
        instrument = yf.Ticker(request.ticker)
        kwargs = {
            "interval": request.interval,
            "auto_adjust": True,
            "actions": False,
            "prepost": request.extended_hours,
            "timeout": 15,
            "raise_errors": True,
        }
        if request.start is not None:
            kwargs.update(start=request.start.isoformat(), end=request.end.isoformat(), period=None)
        else:
            kwargs["period"] = request.period
        from backend.provider import call
        frame = call(instrument.history, **kwargs)
    except HTTPException:
        raise
    except YFRateLimitError as exc:
        raise HTTPException(429, "Yahoo Finance is rate-limiting requests. Wait a minute and try again.", headers={"Retry-After": "60"}) from exc
    except (YFPricesMissingError, YFTzMissingError) as exc:
        raise HTTPException(404, f"No Yahoo Finance history was found for {request.ticker} in this range. Check the ticker, interval, and dates.") from exc
    except Exception as exc:
        logger.warning("Yahoo Finance request failed for %s: %s", request.ticker, type(exc).__name__)
        raise HTTPException(502, "Could not retrieve prices from Yahoo Finance. The provider may be temporarily unavailable; please try again.") from exc
    if frame is None or frame.empty:
        raise HTTPException(404, f"Yahoo Finance returned no candles for {request.ticker}. Check the ticker and choose a range containing trading days.")
    bars, warnings = clean_bars(frame, request.interval)
    if not bars:
        raise HTTPException(502, "Yahoo Finance returned no valid price candles for this selection. Try another range.")

    # history() already fetched these fields; do not request the much slower
    # quote-summary API just to decorate an otherwise usable chart.
    try:
        metadata = instrument.get_history_metadata()
    except Exception:
        metadata = {}
    currency = metadata.get("currency")
    if not currency:
        warnings.append("The data provider did not report the instrument currency.")
    from backend.boundaries import annotate
    annotate(bars, request.interval, metadata, request.ticker)
    result = MarketData(
        ticker=request.ticker,
        extendedHours=request.extended_hours,
        name=metadata.get("longName") or metadata.get("shortName") or request.ticker,
        currency=currency,
        exchange=metadata.get("fullExchangeName") or metadata.get("exchangeName"),
        interval=request.interval,
        exchangeTimezone=metadata.get("exchangeTimezoneName") or "UTC",
        bars=bars,
        fetchedAt=datetime.now(timezone.utc).isoformat(),
        range=DateRange(
            start=datetime.fromtimestamp(bars[0].time, timezone.utc).isoformat(),
            end=datetime.fromtimestamp(bars[-1].time, timezone.utc).isoformat(),
        ),
        warnings=warnings,
    )
    with _cache_lock:
        _cache[request] = (monotonic(), result)
        _cache.move_to_end(request)
        while len(_cache) > CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return result


app = FastAPI(title="Market Replay API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "yfinance"}


@app.get("/api/market-data", response_model=MarketData)
def market_data(
    ticker: str = Query("AAPL", max_length=32),
    interval: str = "1d",
    period: str | None = None,
    start: str | None = None,
    end: str | None = None,
    extendedHours: bool = False,
) -> MarketData:
    # A normal def route runs in FastAPI's worker thread pool; yfinance's
    # blocking network requests never block the ASGI event loop.
    return _load_market_data(replace(validate_request(ticker, interval, period, start, end),extended_hours=extendedHours))


from backend.datasets import router as dataset_router
app.include_router(dataset_router)
from backend.storage import router as storage_router
app.include_router(storage_router)
from backend.live import router as live_router
app.include_router(live_router)

dist = Path(__file__).resolve().parent.parent / "dist"
if dist.is_dir() and (dist / "index.html").is_file():
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "API endpoint not found.")
        candidate = (dist / path).resolve()
        if candidate.is_relative_to(dist) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")

@app.on_event("startup")
def resume_background_monitors():
    from backend.live import recover_background
    recover_background()
