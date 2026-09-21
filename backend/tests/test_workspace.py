import copy
import json
from unittest.mock import patch
from fastapi.testclient import TestClient
import pytest
from backend import main,storage,provider,live

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('REPLAY_DATA_DIR',str(tmp_path))
    monkeypatch.setenv('REPLAY_E2E','1')
    def compute(path,payload=None,method='POST'):
        if path=='/validate': return {'valid':isinstance(payload,dict) and 'account' in payload}
        if path=='/command':
            result=copy.deepcopy(payload['session']);result['cursor']+=1;return result
        return {'id':'job','status':'completed','result':{'trades':[]}}
    monkeypatch.setattr(storage,'engine',compute)
    with TestClient(main.app) as test: yield test

PAYLOAD={'session':{'account':{'orders':[]},'cursor':0,'market':{'bars':[]}},'preferences':{}}
def create(client):
    r=client.post('/api/sessions',json={'name':'Test','payload':PAYLOAD});assert r.status_code==201;return r.json()

def test_revision_control_and_idempotency(client):
    record=create(client);id=record['id']
    assert client.post(f'/api/sessions/{id}/control',json={'client':'a'}).status_code==200
    assert client.post(f'/api/sessions/{id}/control',json={'client':'b'}).status_code==409
    assert client.put(f'/api/sessions/{id}',json={'revision':1,'client':'b','name':'stolen'}).status_code==409
    body={'revision':1,'client':'a','key':'unique','command':{'type':'advance'}}
    first=client.post(f'/api/sessions/{id}/commands',json=body);assert first.status_code==200
    assert client.post(f'/api/sessions/{id}/commands',json=body).json()==first.json()
    assert client.put(f'/api/sessions/{id}',json={'revision':1,'client':'a','name':'old'}).status_code==409
    assert client.post(f'/api/sessions/{id}/control',json={'client':'b','takeover':True}).status_code==200

def test_library_archive_roundtrip(client):
    record=create(client);id=record['id']
    assert client.put(f'/api/sessions/{id}/journal/trade-1',json={'notes':'Entry rationale','tags':'breakout'}).status_code==200
    archive=client.get(f'/api/sessions/{id}/export');assert archive.status_code==200
    imported=client.post('/api/sessions-import',content=archive.content);assert imported.status_code==200
    new=imported.json()['id'];assert new!=id
    assert client.get(f'/api/sessions/{new}/journal').json()[0]['notes']=='Entry rationale'
    assert client.post('/api/sessions-import',content=b'not a zip').status_code==422
    assert len(client.get('/api/sessions').json())==2

def test_import_fingerprint_and_image_validation(client):
    body={'name':'Legacy','payload':PAYLOAD,'fingerprint':'legacy-source'}
    a=client.post('/api/sessions',json=body).json();b=client.post('/api/sessions',json=body).json();assert a['id']==b['id']
    assert client.post(f"/api/sessions/{a['id']}/attachments",content=b'<svg/>').status_code==422

def test_provider_spacing_and_backoff(monkeypatch,tmp_path):
    monkeypatch.setenv("REPLAY_DATA_DIR",str(tmp_path))
    monkeypatch.setattr(provider,"_loaded",False)
    monkeypatch.delenv('REPLAY_E2E',raising=False)
    monkeypatch.setattr(provider,'_last_start',0);monkeypatch.setattr(provider,'_until',0);monkeypatch.setattr(provider,'_streak',0)
    clock=[100.0]
    monkeypatch.setattr(provider.time,'monotonic',lambda:clock[0]);monkeypatch.setattr(provider.time,'time',lambda:clock[0]);monkeypatch.setattr(provider.time,'sleep',lambda s:clock.__setitem__(0,clock[0]+s));monkeypatch.setattr(provider.random,'uniform',lambda a,b:0)
    starts=[]
    for _ in range(6): provider.call(lambda:starts.append(clock[0]))
    assert starts==[100,103,106,109,112,115]
    from yfinance.exceptions import YFRateLimitError
    from fastapi import HTTPException
    def throttle(): raise YFRateLimitError()
    with pytest.raises(HTTPException) as e: provider.call(throttle)
    assert e.value.status_code==429
    assert provider.status()['retryAt']==148
    with pytest.raises(HTTPException): provider.call(lambda:None)
    clock[0]=149
    with pytest.raises(HTTPException): provider.call(throttle)
    assert provider.status()['retryAt']==209
    monkeypatch.setattr(provider,'_until',0)

def test_cadence_and_symbol_limits(client,monkeypatch):
    from backend.boundaries import cadence
    assert cadence('1m')==30;assert cadence('1h')==1800;assert cadence('1d')==43200
    monkeypatch.setattr(live,'_started',True)
    body={'client':'test','config':{'initialCapital':10000,'commissionBps':0,'slippageBps':0},'streams':[{'ticker':f'T{i}','interval':'1m'} for i in range(7)]}
    assert client.post('/api/live',json=body).status_code==422
    body['streams']=body['streams'][:6]
    response=client.post('/api/live',json=body);assert response.status_code==200
    id=response.json()['id'];assert len(response.json()['streams'])==6
    assert client.delete(f'/api/live/{id}').status_code==200
    assert client.post(f'/api/live/{id}/heartbeat',json={'client':'test'}).status_code==409

def test_archive_rejects_invalid_journal_without_partial_import(client):
    import io,zipfile
    original=create(client)
    document={'version':1,'session':original,'journal':[None]}
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w') as archive: archive.writestr('session.json',json.dumps(document))
    assert client.post('/api/sessions-import',content=buffer.getvalue()).status_code==422
    assert len(client.get('/api/sessions').json())==1

def test_completed_candle_metadata_respects_exchange_close():
    from backend.boundaries import annotate
    from backend.main import Bar
    bars=[Bar(time=1735862400,open=100,high=101,low=99,close=100,volume=1)]
    result=annotate(bars,'1d',{'exchangeName':'NMS','exchangeTimezoneName':'America/New_York'},'AAPL')
    from datetime import datetime,timezone
    assert result[0].endTime==int(datetime(2025,1,3,21,tzinfo=timezone.utc).timestamp())
    assert result[0].complete

def test_live_stream_update_uses_put_and_cancellation_is_immediate(client,monkeypatch):
    monkeypatch.setattr(live,'_started',True)
    monkeypatch.setattr(live,'_streams',{})
    monkeypatch.setattr(live,'_sessions',{})
    monkeypatch.setattr(live,'engine',lambda path,payload=None: {**PAYLOAD['session'],'cancelled':True})
    response=client.post('/api/live',json={'client':'owner','config':{},'streams':[{'ticker':'AAPL','interval':'1m'}]})
    id=response.json()['id']
    live._sessions[id]['session']=copy.deepcopy(PAYLOAD['session'])
    updated=client.put(f'/api/live/{id}/streams',json={'client':'owner','streams':[{'ticker':'AAPL','interval':'1m'},{'ticker':'SPY','interval':'1m'}]})
    assert updated.status_code==200
    assert len(updated.json()['streams'])==2
    cancelled=client.post(f'/api/live/{id}/orders',json={'client':'owner','key':'cancel-1','command':{'type':'cancel','id':'pending-1'}})
    assert cancelled.status_code==200
    assert live._sessions[id]['session']['cancelled'] is True
    assert live._sessions[id]['pending']==[]

def test_simultaneous_library_reads_initialize_database_once(client):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses=list(pool.map(lambda _:client.get('/api/strategies'),range(24)))
    assert all(response.status_code==200 for response in responses)
    connection=storage.db()
    with connection:
        assert connection.execute('PRAGMA journal_mode').fetchone()[0]=='wal'
    with pytest.raises(Exception,match='closed database'):
        connection.execute('SELECT 1')

def test_journal_roundtrip_preserves_server_identity(client):
    session=create(client)['id']
    path=f'/api/sessions/{session}/journal/trade-1'
    assert client.put(path,json={'notes':'First entry'}).status_code==200
    note=client.get(f'/api/sessions/{session}/journal').json()[0]
    note['notes']='Edited note'
    assert client.put(path,json=note).status_code==200
    assert client.get(f'/api/sessions/{session}/journal').json()[0]['notes']=='Edited note'
    assert client.put(path,json={**note,'tradeId':'different-trade'}).status_code==200
    assert client.get(f'/api/sessions/{session}/journal').json()[0]['tradeId']=='trade-1'

def test_background_opt_in_restart_and_stop(client,monkeypatch):
    monkeypatch.setattr(live,'_started',True)
    monkeypatch.setattr(live,'_sessions',{})
    monkeypatch.setattr(live,'_streams',{})
    session={'mode':'live','account':{'config':{'initialCapital':1000,'commissionBps':0,'slippageBps':0},'orders':[]},'cursor':0,'market':{'bars':[{'time':100}]},'alertEvents':[{'name':'test'}]}
    response=client.post('/api/live',json={'client':'owner','config':session['account']['config'],'streams':[{'ticker':'AAPL','interval':'1m'}]})
    id=response.json()['id'];live._sessions[id]['session']=session
    assert client.put(f'/api/live/{id}/background',json={'client':'wrong','enabled':True}).status_code==409
    result=client.put(f'/api/live/{id}/background',json={'client':'owner','enabled':True})
    assert result.status_code==200 and result.json()['background'] is True
    live._sessions.clear();live._streams.clear();live.recover_background()
    recovered=client.get(f'/api/live/{id}').json()
    assert recovered['background'] and recovered['active']
    assert recovered['session']==session
    assert client.get('/api/live').json()[0]['events']==1
    assert client.post(f'/api/live/{id}/connect',json={'client':'new'}).json()['controller']=='new'
    assert client.delete(f'/api/live/{id}').status_code==200
    live._sessions.clear();live.recover_background()
    assert client.get('/api/live').json()==[]
