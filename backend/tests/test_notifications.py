import json
import pytest
from fastapi.testclient import TestClient
from backend import main, notifications as n, storage, live

TOKEN = '123456:test_secret'
EVENT = {'id': 'alert:100', 'name': 'Breakout', 'time': 100, 'price': 125}
SNAPSHOT = {'mode': 'live', 'market': {'ticker': 'AAPL', 'interval': '1m'}, 'alertEvents': [EVENT]}

@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('REPLAY_DATA_DIR', str(tmp_path))
    sent = []
    def transport(token, method, payload=None):
        assert token == TOKEN
        if method == 'getMe': return {'username': 'replay_test_bot'}
        if method == 'getUpdates': return [{'message': {'chat': {'id': 123, 'first_name': 'Tester'}}}]
        sent.append(payload)
        return {'message_id': len(sent)}
    monkeypatch.setattr(n, 'telegram', transport)
    # No worker/startup races; drive durable delivery explicitly.
    client = TestClient(main.app)
    return client, sent


def connect(client, **changes):
    return client.put('/api/notifications/telegram', json=dict(token=TOKEN, chatId='123', enabled=True, replay=True) | changes)


def test_settings_secrets_discovery_and_test(setup):
    client, sent = setup
    result = connect(client)
    assert result.status_code == 200
    assert TOKEN not in result.text and 'token' not in result.json()
    assert TOKEN not in client.get('/api/notifications/telegram').text
    assert client.post('/api/notifications/telegram/chats', json={}).json() == [{'id': '123', 'name': 'Tester'}]
    assert connect(client, token='').status_code == 200
    assert client.post('/api/notifications/telegram/test', json={}).status_code == 200
    assert len(sent) == 1
    assert client.delete('/api/notifications/telegram').json()['configured'] is False
    assert client.post('/api/notifications/telegram/test', json={}).status_code == 422


def test_queue_dedupe_history_and_replay_optin(setup):
    client, sent = setup
    connect(client, replay=False)
    with storage.db() as conn:
        n.enqueue(conn, 'restored', SNAPSHOT, SNAPSHOT)
        n.enqueue(conn, 'replay', SNAPSHOT | {'mode': 'replay'}, {})
        n.enqueue(conn, 'live', SNAPSHOT, {})
        n.enqueue(conn, 'live', SNAPSHOT, {})
    n.deliver_one(); n.deliver_one()
    assert len(sent) == 1
    assert 'LIVE' in sent[0]['text'] and 'AAPL' in sent[0]['text'] and '125' in sent[0]['text']
    connect(client)
    body = dict(ticker='AAPL', interval='1m', events=[EVENT])
    assert client.post('/api/notifications/telegram/replay-events', json=body).status_code == 200
    client.post('/api/notifications/telegram/replay-events', json=body)
    n.deliver_one(); n.deliver_one()
    assert len(sent) == 2 and 'REPLAY' in sent[-1]['text']


def test_backoff_and_permanent_errors(setup, monkeypatch):
    client, sent = setup
    connect(client)
    with storage.db() as conn: n.enqueue(conn, 'live', SNAPSHOT, {})
    def fail(*args): raise n.TelegramError(429, 120)
    monkeypatch.setattr(n, 'telegram', fail)
    n.deliver_one()
    with storage.db() as conn:
        row = conn.execute('SELECT * FROM notification_outbox').fetchone()
        assert row['status'] == 'pending' and row['due'] > n.time.time() + 110
        conn.execute('UPDATE notification_outbox SET due=0')
    def denied(*args): raise n.TelegramError(403)
    monkeypatch.setattr(n, 'telegram', denied)
    n.deliver_one()
    assert client.get('/api/notifications/telegram').json()['delivery']['status'] == 'failed'
    assert not sent


def test_destination_change_cancels_pending_and_invalid_token_preserves_settings(setup, monkeypatch):
    client, sent = setup
    connect(client)
    with storage.db() as conn: n.enqueue(conn, 'live', SNAPSHOT, {})
    connect(client, chatId='456')
    n.deliver_one()
    assert not sent
    def invalid(*args): raise n.TelegramError(401)
    monkeypatch.setattr(n, 'telegram', invalid)
    assert connect(client, token='111:bad').status_code == 502
    assert client.get('/api/notifications/telegram').json()['chatId'] == '456'


def test_live_persist_only_queues_new_events(setup):
    client, sent = setup
    connect(client)
    monitor = dict(id='monitor', session=SNAPSHOT, active=True, gap=False, keys=[('AAPL', '1m', False)], pending=[])
    live.persist(monitor)
    n.deliver_one()
    assert not sent  # Initial/imported history is not replayed.
    monitor['session'] = SNAPSHOT | {'alertEvents': [EVENT, EVENT | {'id': 'alert:200', 'time': 200}]}
    live.persist(monitor); live.persist(monitor)
    n.deliver_one(); n.deliver_one()
    assert len(sent) == 1


def test_transport_redacts_token_errors(monkeypatch):
    import httpx
    def unavailable(*args, **kwargs): raise httpx.ConnectError('secret URL ' + TOKEN)
    monkeypatch.setattr(n.httpx, 'post', unavailable)
    with pytest.raises(n.TelegramError) as exc: n.telegram(TOKEN, 'getMe')
    assert TOKEN not in str(exc.value)


def test_saved_replay_command_queues_transactionally(setup, monkeypatch):
    client, sent = setup
    connect(client)
    initial = SNAPSHOT | {'mode': 'replay', 'alertEvents': [], 'account': {'orders': []}, 'cursor': 0}
    def engine(path, payload=None, method='POST'):
        if path == '/validate': return {'valid': True}
        return initial | {'cursor': 1, 'alertEvents': [EVENT]}
    monkeypatch.setattr(storage, 'engine', engine)
    record = client.post('/api/sessions', json={'name': 'Test', 'payload': {'session': initial}}).json()
    route = '/api/sessions/' + record['id']
    client.post(route + '/control', json={'client': 'test'})
    body = {'revision': 1, 'client': 'test', 'key': 'advance-once', 'command': {'type': 'advance'}}
    assert client.post(route + '/commands', json=body).status_code == 200
    assert client.post(route + '/commands', json=body).status_code == 200
    n.deliver_one(); n.deliver_one()
    assert len(sent) == 1 and 'REPLAY' in sent[0]['text']


def test_pending_delivery_survives_reopen_and_disable_cancels(setup):
    client, sent = setup
    connect(client)
    with storage.db() as conn: n.enqueue(conn, 'live', SNAPSHOT, {})
    storage._initialized_databases.clear()  # Simulate a fresh process opening persistent SQLite.
    n.deliver_one()
    assert len(sent) == 1
    with storage.db() as conn: n.enqueue(conn, 'next', SNAPSHOT, {})
    connect(client, enabled=False)
    n.deliver_one()
    assert len(sent) == 1
