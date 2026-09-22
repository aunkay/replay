"""Server-owned Telegram credentials and durable, deduplicated alert delivery."""
import json
import re
import threading
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel, Field
from backend.storage import db

router = APIRouter(prefix='/api/notifications/telegram')
_worker_lock = threading.Lock()
_started = False


class TelegramError(Exception):
    def __init__(self, code=503, retry_after=0):
        self.code = code
        self.retry_after = retry_after
        super().__init__({401: 'Invalid bot token.', 403: 'Bot cannot message this chat. Start or unblock the bot.',
                          400: 'Telegram rejected the chat. Check the chat ID and bot access.',
                          429: 'Telegram rate limited delivery; retry scheduled.'}.get(code, 'Telegram unavailable; please try again.'))


def telegram(token, method, payload=None):
    # Never expose upstream URLs/descriptions: URLs contain the bot secret.
    try:
        response = httpx.post(f'https://api.telegram.org/bot{token}/{method}', json=payload or {}, timeout=12)
        result = response.json()
        if not result.get('ok'):
            raise TelegramError(result.get('error_code', response.status_code), result.get('parameters', {}).get('retry_after', 0))
        return result['result']
    except (httpx.HTTPError, ValueError, KeyError):
        raise TelegramError() from None


def config(conn):
    row = conn.execute('SELECT payload FROM notification_settings WHERE id=1').fetchone()
    return json.loads(row['payload']) if row else dict(token='', chatId='', enabled=False, replay=False, username='')


@router.get('')
def settings():
    with db() as conn:
        c = config(conn)
        last = conn.execute('SELECT status,error FROM notification_outbox ORDER BY rowid DESC LIMIT 1').fetchone()
        return {k: v for k, v in c.items() if k != 'token'} | {'configured': bool(c['token']), 'delivery': dict(last) if last else None}


class Settings(BaseModel):
    token: str = Field(default='', max_length=200)
    chatId: str = Field(max_length=100)
    enabled: bool = False
    replay: bool = False


@router.put('')
def save(body: Settings):
    with db() as conn:
        previous = config(conn)
    token = body.token.strip() or previous['token']
    chat = body.chatId.strip()
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]+', token) or not re.fullmatch(r'-?\d+|@[A-Za-z0-9_]+', chat):
        raise HTTPException(422, 'Enter a valid bot token and numeric chat ID (or channel @username).')
    try:
        bot = telegram(token, 'getMe')
    except TelegramError as exc:
        raise HTTPException(502, str(exc)) from None
    value = dict(token=token, chatId=chat, enabled=body.enabled, replay=body.replay, username=bot.get('username', ''))
    with db() as conn:
        conn.execute('INSERT OR REPLACE INTO notification_settings VALUES(1,?)', (json.dumps(value),))
        # Old pending messages must never go to a newly selected destination.
        if token != previous['token'] or chat != previous['chatId'] or not body.enabled:
            conn.execute("UPDATE notification_outbox SET status='cancelled' WHERE status='pending'")
    return settings()


@router.delete('')
def disconnect():
    with db() as conn:
        conn.execute('DELETE FROM notification_settings')
        conn.execute("UPDATE notification_outbox SET status='cancelled' WHERE status='pending'")
    return settings()


@router.post('/test')
def test_message(body: dict = Body(...)):
    with db() as conn:
        c = config(conn)
    if not c['token']:
        raise HTTPException(422, 'Save your Telegram connection first.')
    try:
        telegram(c['token'], 'sendMessage', {'chat_id': c['chatId'], 'text': 'Replay: Telegram notifications are connected.'})
    except TelegramError as exc:
        raise HTTPException(502, str(exc)) from None
    return {'sent': True}


def enqueue(conn, scope, snapshot, previous):
    """Call inside the same transaction that persists newly evaluated candles."""
    c = config(conn)
    live = snapshot.get('mode') == 'live'
    if not c['enabled'] or not c['token'] or (not live and not c['replay']):
        return
    known = {e['id'] for e in previous.get('alertEvents', [])}
    market = snapshot['market']
    for event in snapshot.get('alertEvents', []):
        if event['id'] in known:
            continue
        timestamp = datetime.fromtimestamp(event['time'], timezone.utc).isoformat()
        message = f"Replay · {'LIVE' if live else 'REPLAY'}\n{market['ticker']} · {market['interval']}\n{event['name']}\nPrice: {event['price']:g}\nCandle: {timestamp}"
        conn.execute('INSERT OR IGNORE INTO notification_outbox(id,message,status,attempts,due,error) VALUES(?,?,\'pending\',0,?,NULL)',
                     (f"{scope}:{event['id']}", message[:4000], time.time()))


class Event(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=100)
    time: float = Field(ge=0, le=253402300799, allow_inf_nan=False)
    price: float = Field(allow_inf_nan=False)


class ReplayEvents(BaseModel):
    ticker: str = Field(min_length=1, max_length=30)
    interval: str = Field(min_length=1, max_length=10)
    events: list[Event] = Field(max_length=200)


@router.post('/replay-events')
def replay_events(body: ReplayEvents):
    with db() as conn:
        enqueue(conn, f'local:{body.ticker}:{body.interval}',
                {'market': {'ticker': body.ticker, 'interval': body.interval},
                 'alertEvents': [e.model_dump() for e in body.events]}, {})
    return {'accepted': True}


def deliver_one():
    # Single process worker; lease also prevents concurrent processes claiming a row.
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        c = config(conn)
        if not c['enabled']:
            return
        row = conn.execute("SELECT * FROM notification_outbox WHERE status='pending' AND due<=? ORDER BY rowid LIMIT 1", (time.time(),)).fetchone()
        if row is None:
            return
        conn.execute('UPDATE notification_outbox SET due=? WHERE id=?', (time.time() + 60, row['id']))
    error, status, delay = None, 'sent', 0
    try:
        telegram(c['token'], 'sendMessage', {'chat_id': c['chatId'], 'text': row['message']})
    except TelegramError as exc:
        error = str(exc)
        status = 'pending' if (exc.code == 429 or exc.code >= 500) and row['attempts'] < 7 else 'failed'
        delay = max(exc.retry_after, min(3600, 5 * 2 ** row['attempts']))
    with db() as conn:
        conn.execute("UPDATE notification_outbox SET status=?,error=?,attempts=attempts+1,due=? WHERE id=? AND status='pending'",
                     (status, error, time.time() + delay, row['id']))


def start_worker():
    global _started
    with _worker_lock:
        if _started:
            return
        _started = True
    def loop():
        while True:
            try:
                deliver_one()
            except Exception:
                # Keep worker alive without logging credentials or private messages.
                pass
            time.sleep(1)
    threading.Thread(target=loop, daemon=True, name='telegram-delivery').start()

class Discover(BaseModel):
    token: str = Field(default='', max_length=200)


@router.post('/chats')
def chats(body: Discover):
    with db() as conn:
        token = body.token.strip() or config(conn)['token']
    if not re.fullmatch(r'\d+:[A-Za-z0-9_-]+', token):
        raise HTTPException(422, 'Enter your bot token first.')
    try:
        updates = telegram(token, 'getUpdates', {'timeout': 0, 'limit': 100})
    except TelegramError as exc:
        raise HTTPException(502, str(exc)) from None
    found = {}
    for update in updates:
        chat = (update.get('message') or update.get('channel_post') or {}).get('chat', {})
        if 'id' in chat:
            found[str(chat['id'])] = {'id': str(chat['id']), 'name': chat.get('title') or chat.get('first_name') or chat.get('username') or str(chat['id'])}
    return list(found.values())
