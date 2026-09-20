"""Run the real API against a local Yahoo provider double, without network I/O.

Playwright starts this module in a separate process. Validation, caching, bar
cleaning, metadata serialization, and HTTP errors all use backend.main.
"""
from __future__ import annotations

import os

import pandas as pd
from yfinance.exceptions import YFRateLimitError

from backend import main

if os.environ.get("REPLAY_E2E") != "1":
    raise RuntimeError("This fixture server is only for REPLAY_E2E=1 browser tests.")


class FixtureTicker:
    def __init__(self, symbol: str):
        self.symbol = symbol

    def history(self, **kwargs) -> pd.DataFrame:
        if self.symbol == "RATELIMIT":
            raise YFRateLimitError()
        if self.symbol not in {"AAPL", "MSFT", "SPY"}:
            return pd.DataFrame()

        interval = kwargs["interval"]
        intraday = interval in main.INTRADAY
        frequencies = {
            "1m": "1min", "2m": "2min", "5m": "5min", "15m": "15min",
            "30m": "30min", "60m": "60min", "1h": "60min", "90m": "90min",
            "1d": "B", "5d": "5B", "1wk": "W-MON", "1mo": "MS", "3mo": "3MS",
        }
        # A fixed clock keeps all price/date expectations reproducible. The real
        # API still validates date bounds against the actual clock before here.
        origin = "2025-01-06T14:30:00Z" if intraday else "2025-01-06T00:00:00Z"
        index = pd.date_range(origin, periods=60, freq=frequencies[interval])
        offset = {"AAPL": 100, "MSFT": 300, "SPY": 500}[self.symbol]
        frame = pd.DataFrame({
            "Open": [offset + i * 2 for i in range(60)],
            "High": [offset + i * 2 + 3 for i in range(60)],
            "Low": [offset + i * 2 - 2 for i in range(60)],
            "Close": [offset + i * 2 + 1 for i in range(60)],
            "Volume": [100_000 + i * 1000 for i in range(60)],
        }, index=index)
        if kwargs.get("start"):
            start = pd.Timestamp(kwargs["start"], tz="UTC")
            end = pd.Timestamp(kwargs["end"], tz="UTC")
            frame = frame.loc[(frame.index >= start) & (frame.index < end)]
        return frame

    def get_history_metadata(self) -> dict[str, str]:
        return {
            "longName": {
                "AAPL": "Apple Inc.",
                "MSFT": "Microsoft Corporation",
                "SPY": "SPDR S&P 500 ETF Trust",
            }[self.symbol],
            "currency": "USD",
            "fullExchangeName": "NasdaqGS",
        }


main.yf.Ticker = FixtureTicker
app = main.app

@app.post('/api/test/reset-provider')
def reset_provider():
    from backend import provider
    with provider._lock:
        provider._until=0;provider._streak=0;provider._success=0
    return {'reset': True}
