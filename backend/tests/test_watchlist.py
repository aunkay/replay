import json
from unittest.mock import Mock
import pandas as pd
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend import main, storage, watchlist as w, provider

@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('REPLAY_DATA_DIR', str(tmp_path))
    monkeypatch.setattr(w, '_lease_until', 0)
    monkeypatch.setattr(w, '_next_start', 0)
    monkeypatch.setattr(provider, 'status', lambda: {'retryAt': None, 'throttleStreak': 0})
    clock=[1000.]
    monkeypatch.setattr(w.time, 'time', lambda: clock[0])
    requests=[]
    def gate(fn):
        requests.append(clock[0])
        return fn()
    monkeypatch.setattr(provider, 'call', gate)
    monkeypatch.setattr(w, 'fetch_quote', lambda ticker: {'ticker':ticker,'price':110.,'previousClose':100.,'changePct':10.,'currency':'USD','sessionDate':'2026-09-28','marketOpen':True})
    return TestClient(main.app),clock,requests


def configure(client, tickers=None, **kwargs):
    return client.put('/api/watchlist', json={'tickers':tickers or ['AAPL','MSFT'],'interval':60,'enabled':True,**kwargs})


def test_validation_normalization_persistence_and_maximum(setup):
    client,clock,requests=setup
    assert configure(client,[' aapl ','spy']).json()['tickers']==['AAPL','SPY']
    assert configure(client,['AAPL','aapl']).status_code==422
    assert configure(client,['bad/path']).status_code==422
    assert configure(client,[f'T{i}' for i in range(11)]).status_code==422
    assert configure(client,interval=1).status_code==422
    assert configure(client,[f'T{i}' for i in range(10)]).status_code==200
    storage._initialized_databases.clear()
    assert len(client.get('/api/watchlist').json()['tickers'])==10
    assert not requests


def test_staggered_shared_polling_cached_snapshots_and_leases(setup):
    client,clock,requests=setup
    configure(client)
    w.poll_once();assert not requests
    client.post('/api/watchlist/heartbeat',json={})
    w.poll_once();w.poll_once()
    assert requests==[1000]
    for _ in range(5):client.post('/api/watchlist/heartbeat',json={})
    w.poll_once();assert len(requests)==1
    clock[0]+=3;w.poll_once()
    assert requests==[1000,1003]
    assert client.get('/api/watchlist').json()['quotes'][0]['changePct']==10
    clock[0]=1060;w.poll_once();assert len(requests)==2 # lease expired
    client.post('/api/watchlist/heartbeat',json={});w.poll_once();assert len(requests)==3
    configure(client,enabled=False);clock[0]+=100;w.poll_once();assert len(requests)==3


def test_throttle_preserves_last_price_and_honors_retry(setup,monkeypatch):
    client,clock,requests=setup
    configure(client,['AAPL']);client.post('/api/watchlist/heartbeat',json={});w.poll_once()
    clock[0]+=61;client.post('/api/watchlist/heartbeat',json={})
    def throttled(fn):raise HTTPException(429,'throttled',headers={'Retry-After':'240'})
    monkeypatch.setattr(provider,'call',throttled)
    w.poll_once()
    q=client.get('/api/watchlist').json()['quotes'][0]
    assert q['price']==110 and q['stale'] and q['nextAttempt']>=1301
    assert 'cooldown' in q['error']
    configure(client,['AAPL'],interval=30) # settings must not bypass backoff
    assert client.get('/api/watchlist').json()['quotes'][0]['nextAttempt']==q['nextAttempt']


def test_failures_back_off_and_removed_tickers_are_not_refetched(setup,monkeypatch):
    client,clock,requests=setup
    configure(client,['AAPL']);client.post('/api/watchlist/heartbeat',json={})
    monkeypatch.setattr(w,'fetch_quote',Mock(side_effect=ValueError('invalid')))
    w.poll_once();assert client.get('/api/watchlist').json()['quotes'][0]['nextAttempt']==1120
    clock[0]=1120;client.post('/api/watchlist/heartbeat',json={});w.poll_once()
    assert client.get('/api/watchlist').json()['quotes'][0]['nextAttempt']==1360
    client.put('/api/watchlist',json={'tickers':[],'interval':60,'enabled':True})
    clock[0]=1360;client.post('/api/watchlist/heartbeat',json={});w.poll_once()
    assert len(requests)==2


def test_quote_uses_previous_session_close_and_reuses_history_metadata(monkeypatch):
    frame=pd.DataFrame({'Close':[100.,105.,110.]}, index=pd.date_range('2026-09-25', periods=3))
    ticker=Mock();ticker.history.return_value=frame;ticker.get_history_metadata.return_value={'currency':'USD'}
    monkeypatch.setattr(main.yf,'Ticker',lambda symbol:ticker)
    q=w.fetch_quote('AAPL')
    assert q['price']==110 and q['previousClose']==105
    assert q['changePct']==pytest.approx((110/105-1)*100)
    assert q['asOf'] is None and q['sessionDate']=='2026-09-27'
    assert ticker.history.call_args.kwargs['auto_adjust'] is False
    assert ticker.history.call_count==1


def test_closed_markets_slow_down_and_global_cooldown_blocks_calls(setup,monkeypatch):
    client,clock,requests=setup
    configure(client,['AAPL']);client.post('/api/watchlist/heartbeat',json={})
    monkeypatch.setattr(w,'fetch_quote',lambda ticker:{'ticker':ticker,'price':100.,'marketOpen':False})
    w.poll_once();assert client.get('/api/watchlist').json()['quotes'][0]['nextAttempt']==1300
    configure(client,['AAPL'],interval=30)
    assert client.get('/api/watchlist').json()['quotes'][0]['nextAttempt']==1300
    clock[0]=1300;client.post('/api/watchlist/heartbeat',json={})
    monkeypatch.setattr(provider,'status',lambda:{'retryAt':1500,'throttleStreak':2})
    w.poll_once();assert len(requests)==1
