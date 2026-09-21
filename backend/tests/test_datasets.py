from fastapi.testclient import TestClient
from backend import main,datasets
import pytest
@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setenv('REPLAY_DATA_DIR',str(tmp_path))
    monkeypatch.setattr(datasets,'engine',lambda path,data:{'valid':True})
    with TestClient(main.app) as c: yield c
CSV='time,open,high,low,close,volume\n2020-01-01,100,102,99,101,100\n2020-01-03,101,103,100,102,200'
def test_import_store_inspect_delete(client):
    response=client.post('/api/datasets/import',json={'name':'Research','ticker':'CUSTOM','interval':'1d','csv':CSV})
    assert response.status_code==201
    result=response.json();assert result['market']['source']=='csv'
    assert result['gaps'][0]['missingSlots']==1
    assert client.get('/api/datasets').json()[0]['count']==2
    assert client.get('/api/datasets/'+result['id']).json()==result
    assert client.delete('/api/datasets/'+result['id']).status_code==200
    assert client.get('/api/datasets').json()==[]
@pytest.mark.parametrize('csv',[CSV.replace('2020-01-03','2020-01-01'),CSV.replace('2020-01-03','2019-01-01'),CSV.replace('100,102','100,nan'),CSV.replace('time,open','time,time'),CSV.replace('2020-01-01','1577836800000')])
def test_bad_csv_rejected(client,csv):
    r=client.post('/api/datasets/import',json={'name':'bad','ticker':'X','interval':'1d','csv':csv})
    assert r.status_code==422
    assert client.get('/api/datasets').json()==[]
