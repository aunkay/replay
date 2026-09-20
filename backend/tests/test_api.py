from datetime import date
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
import pandas as pd
import pytest
from yfinance.exceptions import YFRateLimitError

from backend import main


@pytest.fixture(autouse=True)
def clear_cache(monkeypatch):
    from backend import provider
    monkeypatch.setenv("REPLAY_E2E", "1")
    monkeypatch.setattr(provider, "_until", 0)
    monkeypatch.setattr(provider, "_streak", 0)
    main._cache.clear()
    yield
    main._cache.clear()


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


@pytest.fixture
def instrument():
    ticker = MagicMock()
    ticker.history.return_value = pd.DataFrame(
        {"Open": [100, 102], "High": [104, 105], "Low": [99, 100], "Close": [102, 104], "Volume": [1000, 1100]},
        index=pd.DatetimeIndex(["2025-01-02", "2025-01-03"], tz="America/New_York"),
    )
    ticker.get_history_metadata.return_value = {"longName": "Apple Inc.", "currency": "USD", "fullExchangeName": "NasdaqGS"}
    with patch.object(main.yf, "Ticker", return_value=ticker) as factory:
        yield ticker, factory


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok", "provider": "yfinance"}


def test_normalized_candles_and_cache(client, instrument):
    ticker, factory = instrument
    response = client.get("/api/market-data", params={"ticker": "aapl", "interval": "1d", "period": "1y"})
    assert response.status_code == 200
    result = response.json()
    assert result["ticker"] == "AAPL"
    assert result["source"] == "yfinance"
    assert result["adjusted"] is True
    assert result["currency"] == "USD"
    assert {k:v for k,v in result["bars"][0].items() if k not in {"endTime","complete"}} == {"time": 1735776000, "open": 100, "high": 104, "low": 99, "close": 102, "volume": 1000}
    ticker.history.assert_called_once_with(interval="1d", auto_adjust=True, actions=False, prepost=False, timeout=15, raise_errors=True, period="1y")
    assert client.get("/api/market-data").json() == result
    factory.assert_called_once_with("AAPL")


@pytest.mark.parametrize("params, message", [
    ({"ticker": "AAPL,MSFT"}, "one valid"),
    ({"interval": "7h"}, "Unsupported interval"),
    ({"period": "100y"}, "Unsupported period"),
    ({"start": "2025-01-01"}, "both start and end"),
    ({"start": "2025-01-01", "end": "2025-02-01", "period": "1mo"}, "either a period"),
    ({"start": "2025-02-01", "end": "2025-01-01"}, "start date must be before"),
    ({"start": "2025-02-30", "end": "2025-03-01"}, "valid calendar date"),
    ({"start": "2025-1-1", "end": "2025-02-01"}, "YYYY-MM-DD"),
    ({"interval": "1m", "period": "1mo"}, "7-day window"),
    ({"interval": "5m", "period": "1y"}, "last 60 days"),
    ({"interval": "1h", "period": "5y"}, "last 730 days"),
    ({"start": "2030-01-01", "end": "2030-02-01"}, "future"),
])
def test_invalid_requests_do_not_contact_yahoo(client, instrument, params, message):
    with patch.object(main, "utc_today", return_value=date(2025, 6, 15)):
        response = client.get("/api/market-data", params=params)
    assert response.status_code == 400
    assert message in response.json()["detail"]
    instrument[1].assert_not_called()


def test_intraday_rejects_old_dates_even_if_window_short(client, instrument):
    with patch.object(main, "utc_today", return_value=date(2025, 6, 15)):
        response = client.get("/api/market-data", params={"interval": "5m", "start": "2024-01-01", "end": "2024-01-02"})
    assert response.status_code == 400
    assert "last 60 days" in response.json()["detail"]


def test_date_request_passes_end_exclusively(client, instrument):
    response = client.get("/api/market-data", params={"start": "2025-01-01", "end": "2025-01-04"})
    assert response.status_code == 200
    kwargs = instrument[0].history.call_args.kwargs
    assert kwargs["start"] == "2025-01-01"
    assert kwargs["end"] == "2025-01-04"
    assert kwargs["period"] is None


def test_empty_response_is_explicit(client, instrument):
    instrument[0].history.return_value = pd.DataFrame()
    response = client.get("/api/market-data")
    assert response.status_code == 404
    assert "no candles" in response.json()["detail"]


def test_provider_failure_is_not_exposed_or_replaced_with_fake_prices(client, instrument):
    instrument[0].history.side_effect = RuntimeError("internal request detail")
    response = client.get("/api/market-data")
    assert response.status_code == 502
    assert "internal request detail" not in response.text
    assert "bars" not in response.json()


def test_rate_limit_is_actionable(client, instrument):
    instrument[0].history.side_effect = YFRateLimitError()
    response = client.get("/api/market-data")
    assert response.status_code == 429
    assert 30 <= int(response.headers["retry-after"]) <= 37


def test_bar_cleaning_drops_invalid_and_sorts_deduplicates():
    frame = pd.DataFrame(
        {"Open": [100, 101, float("nan"), 103, 104], "High": [104, 105, 106, 102, 108], "Low": [99, 99, 99, 99, 99], "Close": [102, 103, 103, 103, 106], "Volume": [10, float("inf"), 1, 1, 10]},
        index=pd.DatetimeIndex(["2025-01-03", "2025-01-02", "2025-01-04", "2025-01-05", "2025-01-03"], tz="America/New_York"),
    )
    bars, warnings = main.clean_bars(frame, "1d")
    assert len(bars) == 2
    assert bars[0].time < bars[1].time
    assert bars[0].volume == 0
    assert bars[1].close == 106
    assert len(warnings) == 3


def test_intraday_timestamp_preserves_instant():
    frame = pd.DataFrame({"Open": [100], "High": [104], "Low": [99], "Close": [102], "Volume": [10]}, index=pd.DatetimeIndex(["2025-01-02 09:30:00"], tz="America/New_York"))
    bars, _ = main.clean_bars(frame, "5m")
    assert bars[0].time == int(pd.Timestamp("2025-01-02T14:30:00Z").timestamp())


def test_cache_expires(client, instrument):
    with patch.object(main, "monotonic", return_value=100):
        assert client.get("/api/market-data").status_code == 200
    with patch.object(main, "monotonic", return_value=100 + main.CACHE_TTL_SECONDS + 1):
        assert client.get("/api/market-data").status_code == 200
    assert instrument[0].history.call_count == 2
