"""Shared, lease-driven watchlist quotes. All Yahoo work uses the provider gate."""
import copy
import json
import math
import re
import threading
import time
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field
from backend.storage import db
from backend import provider

router = APIRouter(prefix='/api/watchlist')
_lock = threading.RLock()
_poll_lock = threading.Lock()
_started = False
_lease_until = 0.0
_next_start = 0.0


def load(conn):
    row = conn.execute('SELECT payload FROM watchlist WHERE id=1').fetchone()
    return json.loads(row['payload']) if row else {'tickers': [], 'interval': 60, 'enabled': True, 'quotes': {}}


def write(conn, value):
    conn.execute('INSERT OR REPLACE INTO watchlist VALUES(1,?)', (json.dumps(value),))


def public(value):
    now = time.time()
    quotes = []
    for ticker in value['tickers']:
        q = copy.deepcopy(value['quotes'].get(ticker, {'ticker': ticker}))
        q['stale'] = bool(q.get('error') or not q.get('fetchedAt') or now - q['fetchedAt'] > max(value['interval'] * 2, 330 if q.get('marketOpen') is False else 120))
        q.pop('failures', None)
        quotes.append(q)
    return {**{k: value[k] for k in ['tickers', 'interval', 'enabled']}, 'quotes': quotes, 'provider': provider.status(), 'monitoring': value['enabled'] and _lease_until > now}


@router.get('')
def snapshot():
    with _lock, db() as conn:
        return public(load(conn))


@router.post('/heartbeat')
def heartbeat(body: dict = Body(...)):
    global _lease_until
    with _lock:
        _lease_until = time.time() + 45
    start_worker()
    return snapshot()


class Settings(BaseModel):
    tickers: list[str] = Field(max_length=10)
    interval: int = 60
    enabled: bool = True


@router.put('')
def settings(body: Settings):
    if body.interval not in [30, 60, 120, 300]:
        raise HTTPException(422, 'Choose 30, 60, 120 or 300 seconds.')
    tickers = [t.strip().upper() for t in body.tickers]
    if len(set(tickers)) != len(tickers) or any(not re.fullmatch(r'[A-Z0-9^][A-Z0-9.^=_-]{0,31}', t) for t in tickers):
        raise HTTPException(422, 'Use up to 10 distinct Yahoo ticker symbols.')
    with _lock, db() as conn:
        old = load(conn)
        value = dict(tickers=tickers, interval=body.interval, enabled=body.enabled, quotes={})
        for i, ticker in enumerate(tickers):
            q = old['quotes'].get(ticker, {'ticker': ticker, 'nextAttempt': time.time() + i * 3})
            if old['interval'] != body.interval and q.get('lastAttempt') and not q.get('error'):
                q['nextAttempt'] = max(time.time() + i * 3, q['lastAttempt'] + max(body.interval, 300 if q.get('marketOpen') is False else 0))
            value['quotes'][ticker] = q
        write(conn, value)
        return public(value)


def fetch_quote(ticker):
    # One short daily history gives the current regular-session close and its
    # previous session reference without a second quote-summary request.
    from backend.main import yf
    instrument = yf.Ticker(ticker)
    frame = instrument.history(period='5d', interval='1d', auto_adjust=False, prepost=False, actions=False, timeout=10, raise_errors=True)
    if frame is None or frame.empty:
        raise ValueError('No quote available')
    closes = frame['Close'].dropna()
    closes = closes[[math.isfinite(float(v)) and float(v) > 0 for v in closes]]
    if closes.empty:
        raise ValueError('No quote available')
    price = float(closes.iloc[-1])
    previous = float(closes.iloc[-2]) if len(closes) > 1 else None
    # yfinance history populated this metadata; no fast_info/info endpoints.
    metadata = instrument.get_history_metadata() or {}
    regular = metadata.get('currentTradingPeriod', {}).get('regular', {})
    now = time.time()
    opened, closed = regular.get('start'), regular.get('end')
    market_open = opened <= now < closed if isinstance(opened, (float, int)) and isinstance(closed, (float, int)) else None
    as_of = metadata.get('regularMarketTime')
    return {'ticker': ticker, 'price': price, 'previousClose': previous,
            'changePct': (price / previous - 1) * 100 if previous else None,
            'currency': metadata.get('currency'), 'sessionDate': str(closes.index[-1].date()),
            'asOf': as_of if isinstance(as_of, (float, int)) and math.isfinite(as_of) else None,
            'marketOpen': market_open}


def poll_once():
    """At most one quote per call, no concurrent fetches or browser fan-out."""
    global _next_start
    if not _poll_lock.acquire(blocking=False):
        return
    try:
        now = time.time()
        with _lock, db() as conn:
            value = load(conn)
            if not value['enabled'] or now >= _lease_until or now < _next_start or now < (provider.status()['retryAt'] or 0):
                return
            due = [q for q in value['quotes'].values() if q.get('nextAttempt', 0) <= now]
            if not due:
                return
            quote = min(due, key=lambda q: (q.get('nextAttempt', 0), q.get('lastAttempt', 0)))
            ticker = quote['ticker']
            _next_start = now + 3
        fetched = None
        error = None
        retry = 0
        try:
            fetched = provider.call(lambda: fetch_quote(ticker))
        except HTTPException as exc:
            error = 'Yahoo cooldown; retaining last quote.' if exc.status_code == 429 else 'Yahoo quote unavailable; retry scheduled.'
            try: retry = float((exc.headers or {}).get('Retry-After', 0))
            except (TypeError, ValueError): retry = 0
        except Exception:
            error = 'Quote unavailable. Check the ticker; retry scheduled.'
        with _lock, db() as conn:
            current = load(conn)
            if ticker not in current['tickers']:
                return
            q = current['quotes'][ticker]
            q['lastAttempt'] = now
            if fetched:
                q.update(fetched, fetchedAt=time.time(), failures=0, error=None)
                delay = max(current['interval'], 300 if fetched.get('marketOpen') is False else 0)
            else:
                q['failures'] = q.get('failures', 0) + 1
                q['error'] = error
                delay = max(retry, min(900, current['interval'] * 2 ** min(q['failures'], 5)))
            q['nextAttempt'] = max(time.time() + delay, provider.status()['retryAt'] or 0)
            write(conn, current)
    finally:
        _poll_lock.release()


def start_worker():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    def loop():
        while True:
            try: poll_once()
            except Exception: pass  # Transient DB failure must not kill monitoring.
            time.sleep(.5)
    threading.Thread(target=loop, daemon=True, name='watchlist-quotes').start()
