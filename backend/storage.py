"""Versioned, transactional session library. Data survives container recreation."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid
import zipfile
from threading import Lock
from fastapi import APIRouter, Body, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
import httpx

router = APIRouter(prefix='/api')

def directory() -> Path:
    path=Path(os.environ.get('REPLAY_DATA_DIR','.replay-data'))
    path.mkdir(parents=True,exist_ok=True)
    return path

_database_init_lock = Lock()
_initialized_databases = set()

class DatabaseConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()

def db():
    path = (directory() / 'replay.sqlite').resolve()
    with _database_init_lock:
        initialize = path not in _initialized_databases or not path.exists()
        conn = sqlite3.connect(path, timeout=15, factory=DatabaseConnection)
        conn.row_factory = sqlite3.Row
        if not initialize:
            return conn
        # Changing journal mode concurrently on a new database can fail before
        # busy_timeout applies. Initialize once before accepting other readers.
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS datasets(id TEXT PRIMARY KEY,name TEXT NOT NULL,market TEXT NOT NULL,gaps TEXT NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_version VALUES(1);
        CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,updated REAL NOT NULL,archived INTEGER NOT NULL DEFAULT 0,fingerprint TEXT UNIQUE,controller TEXT,lease REAL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS commands(session_id TEXT,key TEXT,response TEXT,PRIMARY KEY(session_id,key));
        CREATE TABLE IF NOT EXISTS journals(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,trade_id TEXT NOT NULL,payload TEXT NOT NULL,updated REAL NOT NULL,UNIQUE(session_id,trade_id));
        CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS strategies(id TEXT PRIMARY KEY,name TEXT NOT NULL,payload TEXT NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,engine_id TEXT,payload TEXT NOT NULL,result TEXT,status TEXT,updated REAL);
        ''')
        _initialized_databases.add(path)
    return conn

def engine(path: str, payload=None, method='POST'):
    try:
        result=httpx.request(method,os.environ.get('REPLAY_ENGINE_URL','http://127.0.0.1:8003')+path,json=payload,timeout=30)
        if result.is_error: raise HTTPException(result.status_code,result.json().get('detail','Engine error'))
        return result.json()
    except httpx.HTTPError as exc: raise HTTPException(503,'Trading engine unavailable; no command was applied.') from exc

def get_record(conn,id):
    row=conn.execute('SELECT * FROM sessions WHERE id=?',(id,)).fetchone()
    if row is None: raise HTTPException(404,'Session not found')
    return row

def public(row):
    return dict(id=row['id'],name=row['name'],revision=row['revision'],updated=row['updated'],archived=bool(row['archived']),payload=json.loads(row['payload']),controller=row['controller'] if row['lease']>time.time() else None)

def validate_payload(payload):
    if not isinstance(payload,dict) or not isinstance(payload.get('session'),dict): raise HTTPException(422,'A session snapshot is required')
    if len(json.dumps(payload))>32*1024*1024: raise HTTPException(413,'Session exceeds 32 MB')
    if not engine('/validate',payload['session']).get('valid'): raise HTTPException(422,'Invalid trading session')

@router.get('/sessions')
def list_sessions():
    with db() as conn:
        return [dict(id=r['id'],name=r['name'],revision=r['revision'],updated=r['updated'],archived=bool(r['archived'])) for r in conn.execute('SELECT id,name,revision,updated,archived FROM sessions ORDER BY updated DESC')]

@router.post('/sessions',status_code=201)
def create_session(body:dict=Body(...)):
    validate_payload(body.get('payload'))
    name=str(body.get('name','Untitled session')).strip()[:120]
    if not name: raise HTTPException(422,'Name is required')
    fingerprint=body.get('fingerprint')
    if fingerprint is not None: fingerprint=hashlib.sha256(str(fingerprint).encode()).hexdigest()
    with db() as conn:
        if fingerprint:
            old=conn.execute('SELECT * FROM sessions WHERE fingerprint=?',(fingerprint,)).fetchone()
            if old: return public(old)
        id=str(uuid.uuid4())
        conn.execute('INSERT INTO sessions(id,name,revision,payload,updated,fingerprint) VALUES(?,?,1,?,?,?)',(id,name,json.dumps(body['payload']),time.time(),fingerprint))
        return public(get_record(conn,id))

@router.get('/sessions/{id}')
def read_session(id:str):
    with db() as conn: return public(get_record(conn,id))

@router.post('/sessions/{id}/control')
def control(id:str,body:dict=Body(...)):
    client=str(body.get('client',''))[:100]
    if not client: raise HTTPException(422,'Client identifier required')
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=get_record(conn,id)
        if row['lease']>time.time() and row['controller']!=client and not body.get('takeover'): raise HTTPException(409,'Another device controls this session')
        conn.execute('UPDATE sessions SET controller=?,lease=? WHERE id=?',(client,time.time()+60,id))
        return public(get_record(conn,id))

def writable(row,body):
    if body.get('revision')!=row['revision']: raise HTTPException(409,'Session changed on another device; reload before editing')
    if row['controller'] and row['lease']>time.time() and body.get('client')!=row['controller']: raise HTTPException(409,'Another device controls this session')

@router.put('/sessions/{id}')
def update_session(id:str,body:dict=Body(...)):
    if 'payload' in body: validate_payload(body['payload'])
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE');row=get_record(conn,id);writable(row,body)
        conn.execute('UPDATE sessions SET name=?,archived=?,payload=?,revision=revision+1,updated=? WHERE id=?',(str(body.get('name',row['name']))[:120],bool(body.get('archived',row['archived'])),json.dumps(body['payload']) if 'payload' in body else row['payload'],time.time(),id))
        return public(get_record(conn,id))

@router.post('/sessions/{id}/commands')
def command(id:str,body:dict=Body(...)):
    key=body.get('key')
    if not isinstance(key,str) or not 1<=len(key)<=100: raise HTTPException(422,'Idempotency key required')
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE');row=get_record(conn,id)
        old=conn.execute('SELECT response FROM commands WHERE session_id=? AND key=?',(id,key)).fetchone()
        if old: return json.loads(old['response'])
        writable(row,body)
        payload=json.loads(row['payload'])
        payload['session']=engine('/command',dict(session=payload['session'],command=body.get('command')))
        # Materialize opening-trade journal rows without replacing user notes.
        position=0.0
        for order in sorted(payload['session']['account']['orders'],key=lambda o:o.get('filledAt') or 0):
            if order.get('status')!='filled': continue
            signed=order['quantity']*(1 if order['side']=='buy' else -1)
            if position==0 or position*(position+signed)<0:
                conn.execute('INSERT OR IGNORE INTO journals VALUES(?,?,?,?,?)',(str(uuid.uuid4()),id,order['id'],json.dumps({'setup':'','tags':'','entryRationale':'','exitRationale':'','notes':'','images':[]}),time.time()))
            position+=signed
            if abs(position)<1e-9: position=0

        conn.execute('UPDATE sessions SET payload=?,revision=revision+1,updated=? WHERE id=?',(json.dumps(payload),time.time(),id))
        result=public(get_record(conn,id))
        conn.execute('INSERT INTO commands VALUES(?,?,?)',(id,key,json.dumps(result)))
        return result

@router.delete('/sessions/{id}')
def delete_session(id:str):
    with db() as conn:
        get_record(conn,id)
        for table,column in [('commands','session_id'),('journals','session_id'),('attachments','session_id'),('sessions','id')]: conn.execute(f'DELETE FROM {table} WHERE {column}=?',(id,))
    return {'deleted':True}

@router.get('/sessions/{id}/journal')
def journal(id:str):
    with db() as conn:
        get_record(conn,id)
        return [{**json.loads(r['payload']), 'id':r['id'], 'tradeId':r['trade_id']} for r in conn.execute('SELECT * FROM journals WHERE session_id=? ORDER BY updated DESC',(id,))]

@router.put('/sessions/{id}/journal/{trade}')
def save_journal(id:str,trade:str,body:dict=Body(...)):
    body={key:value for key,value in body.items() if key not in ['id','tradeId']}
    if len(json.dumps(body))>100000: raise HTTPException(413,'Journal entry is too large')
    with db() as conn:
        get_record(conn,id)
        conn.execute('INSERT INTO journals VALUES(?,?,?,?,?) ON CONFLICT(session_id,trade_id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated',(str(uuid.uuid4()),id,trade,json.dumps(body),time.time()))
    return body

@router.post('/sessions/{id}/attachments')
async def attachment(id:str,request:Request):
    content=await request.body()
    if len(content)>8*1024*1024: raise HTTPException(413,'Maximum image size is 8 MB')
    if not content.startswith(b'\x89PNG\r\n\x1a\n'): raise HTTPException(422,'PNG screenshot required')
    with db() as conn:
        get_record(conn,id);image=str(uuid.uuid4())
        conn.execute('INSERT INTO attachments VALUES(?,?,?,?)',(image,id,'image/png',content))
    return {'id':image,'url':f'/api/attachments/{image}'}

@router.get('/attachments/{id}')
def read_attachment(id:str):
    with db() as conn:
        row=conn.execute('SELECT * FROM attachments WHERE id=?',(id,)).fetchone()
        if not row: raise HTTPException(404,'Image not found')
        return Response(row['data'],media_type=row['mime'],headers={'X-Content-Type-Options':'nosniff'})

@router.get('/sessions/{id}/export')
def export_session(id:str):
    with db() as conn:
        row=public(get_record(conn,id));notes=journal(id)
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('session.json',json.dumps({'version':1,'session':row,'journal':notes}))
            for image in conn.execute('SELECT * FROM attachments WHERE session_id=?',(id,)): archive.writestr(f"images/{image['id']}.png",image['data'])
        output.seek(0)
        return StreamingResponse(output,media_type='application/zip',headers={'Content-Disposition':'attachment; filename="replay-session.zip"'})

@router.post('/sessions-import')
async def import_session(request:Request):
    content=await request.body()
    if len(content)>64*1024*1024: raise HTTPException(413,'Archive exceeds 64 MB')
    try:
        archive=zipfile.ZipFile(io.BytesIO(content))
        if sum(i.file_size for i in archive.infolist())>128*1024*1024 or len(archive.infolist())>1000: raise ValueError('Archive too large')
        data=json.loads(archive.read('session.json'))
        if data.get('version')!=1: raise ValueError('Unsupported archive version')
        validate_payload(data['session']['payload'])
        images={name:archive.read(name) for name in archive.namelist() if name.startswith('images/')}
        if any(not b.startswith(b'\x89PNG\r\n\x1a\n') or len(b)>8*1024*1024 for b in images.values()): raise ValueError('Invalid screenshot')
    except (ValueError,KeyError,zipfile.BadZipFile) as exc: raise HTTPException(422,'Invalid session archive') from exc
    notes=data.get('journal',[])
    if not isinstance(notes,list) or len(notes)>10000 or any(not isinstance(n,dict) or not isinstance(n.get('tradeId'),str) or not 1<=len(n['tradeId'])<=100 for n in notes):
        raise HTTPException(422,'Invalid journal in archive')
    if len({n['tradeId'] for n in notes})!=len(notes): raise HTTPException(422,'Duplicate journal entries in archive')
    id=str(uuid.uuid4())
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT INTO sessions(id,name,revision,payload,updated) VALUES(?,?,1,?,?)',(id,str(data['session'].get('name','Imported session'))[:100]+' (imported)',json.dumps(data['session']['payload']),time.time()))
        mapping={}
        for name,blob in images.items():
            old=Path(name).stem;new=str(uuid.uuid4());mapping[old]=new
            conn.execute('INSERT INTO attachments VALUES(?,?,?,?)',(new,id,'image/png',blob))
        for original in notes:
            note={**original};trade=note.pop('tradeId');note.pop('id',None)
            note['images']=[f'/api/attachments/{mapping[url.rsplit("/",1)[-1]]}' for url in note.get('images',[]) if isinstance(url,str) and url.rsplit('/',1)[-1] in mapping]
            conn.execute('INSERT INTO journals VALUES(?,?,?,?,?)',(str(uuid.uuid4()),id,trade,json.dumps(note),time.time()))
        return public(get_record(conn,id))


@router.get('/strategies')
def strategies():
    with db() as conn: return [dict(id=r['id'],name=r['name'],strategy=json.loads(r['payload'])) for r in conn.execute('SELECT * FROM strategies ORDER BY updated DESC')]

@router.post('/strategies')
def save_strategy(body:dict=Body(...)):
    strategy=body.get('strategy',{})
    if strategy.get('version')!=1: raise HTTPException(422,'Unsupported strategy version')
    engine('/validate-strategy',strategy)
    id=str(body.get('id') or uuid.uuid4())
    with db() as conn: conn.execute('INSERT INTO strategies VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload=excluded.payload,updated=excluded.updated',(id,str(strategy.get('name','Strategy'))[:120],json.dumps(strategy),time.time()))
    return {'id':id}

@router.post('/strategy-runs',status_code=202)
def start_run(body:dict=Body(...)):
    if not isinstance(body.get('bars'),list) or not 2<=len(body['bars'])<=100000: raise HTTPException(422,'Choose 2–100,000 candles')
    engine('/validate-strategy',body.get('strategy'))
    body={**body,'engineVersion':'3','datasetHash':hashlib.sha256(json.dumps(body['bars'],sort_keys=True).encode()).hexdigest()}
    job=engine('/jobs',body);id=str(uuid.uuid4())
    with db() as conn: conn.execute('INSERT INTO runs VALUES(?,?,?,?,?,?)',(id,job['id'],json.dumps(body),None,job['status'],time.time()))
    # Persist completed results even when the browser closes during a run.
    import threading
    def monitor():
        while True:
            time.sleep(1)
            try:
                result=run_status(id)
                if result['status'] not in ['queued','running']: return
            except HTTPException as exc:
                if exc.status_code==404: return
                if exc.status_code==503:
                    with db() as conn:
                        conn.execute('UPDATE runs SET status=?,result=? WHERE id=? AND result IS NULL',('interrupted',json.dumps({'status':'interrupted','error':'Engine unavailable; submit a new run'}),id))
                    return
    threading.Thread(target=monitor,daemon=True,name='replay-run-'+id).start()
    return {'id':id,'status':job['status']}

@router.get('/strategy-runs')
def runs():
    with db() as conn: return [dict(id=r['id'],status=r['status'],updated=r['updated']) for r in conn.execute('SELECT id,status,updated FROM runs ORDER BY updated DESC')]

@router.get('/strategy-runs/{id}')
def run_status(id:str):
    with db() as conn:
        row=conn.execute('SELECT * FROM runs WHERE id=?',(id,)).fetchone()
        if not row: raise HTTPException(404,'Run not found')
        if row['result']: return json.loads(row['result'])
        try: result=engine('/jobs/'+row['engine_id'],method='GET')
        except HTTPException as exc:
            if exc.status_code!=404: raise
            result={'status':'interrupted','error':'Engine restarted; submit a new run'}
        result['metadata']={k:json.loads(row['payload']).get(k) for k in ['engineVersion','datasetHash']}
        done=result['status'] not in ['running','queued']
        conn.execute('UPDATE runs SET status=?,result=?,updated=? WHERE id=?',(result['status'],json.dumps(result) if done else None,time.time(),id))
        return result

@router.delete('/strategy-runs/{id}')
def cancel_run(id:str):
    with db() as conn:
        row=conn.execute('SELECT engine_id FROM runs WHERE id=?',(id,)).fetchone()
        if not row: raise HTTPException(404,'Run not found')
        result=engine('/jobs/'+row['engine_id'],method='DELETE')
        conn.execute('UPDATE runs SET status=?,result=? WHERE id=?',('cancelled',json.dumps(result),id))
        return result

@router.get('/sessions/{id}/events')
async def session_events(id:str,request:Request):
    import asyncio
    with db() as conn: get_record(conn,id)
    async def updates():
        last=-1
        while not await request.is_disconnected():
            with db() as conn: record=public(get_record(conn,id))
            if record['revision']!=last:
                last=record['revision']
                yield f"id: {last}\ndata: {json.dumps(record)}\n\n"
            else: yield ': heartbeat\n\n'
            await asyncio.sleep(2)
    return StreamingResponse(updates(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
