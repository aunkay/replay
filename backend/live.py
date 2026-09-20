"""Lease-bound live streams. A single fair loop feeds all connected workspaces."""
from __future__ import annotations
import copy
import threading
import time
import uuid
from fastapi import APIRouter,Body,HTTPException
from backend.boundaries import cadence
from backend.provider import status as provider_status
from backend.storage import engine,db
router=APIRouter(prefix='/api/live')
_lock=threading.RLock()
_streams={}
_sessions={}
_started=False

def stream_key(ticker,interval): return (ticker.upper(),'60m' if interval=='1h' else interval)

def persist(session):
    if not session.get('session'): return
    import json
    snapshot=copy.deepcopy(session['session']);snapshot['mode']='live'
    payload=json.dumps({'session':snapshot,'live':{'active':False,'gap':True,'streams':[{'ticker':key[0],'interval':key[1]} for key in session['keys']],'pending':session['pending']}})
    with db() as conn:
        conn.execute('INSERT INTO sessions(id,name,revision,payload,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=sessions.revision+1,updated=excluded.updated',(session['id'],f"Live {session['keys'][0][0]}",1,payload,time.time()))

def snapshot(session):
    return {k:copy.deepcopy(v) for k,v in session.items() if k not in ['leases','pending','commands']} | {'streams':[copy.deepcopy(_streams[k]) for k in session['keys'] if k in _streams],'provider':provider_status(),'pendingOrders':copy.deepcopy(session['pending'])}

def _loop():
    from backend.main import _load_market_data,validate_request
    while True:
        time.sleep(.25)
        now=time.time()
        with _lock:
            for session in _sessions.values():
                if session['active'] and not any(expiry>now for expiry in session['leases'].values()):
                    session['active']=False;session['gap']=True
            wanted={k for session in _sessions.values() if session['active'] for k in session['keys']}
            due=[k for k in wanted if _streams[k]['nextAttempt']<=now and not _streams[k].get('permanent')]
            if not due: continue
            key=min(due,key=lambda k:(_streams[k]['nextAttempt'],_streams[k].get('lastAttempt',0)))
            stream=_streams[key];stream['lastAttempt']=now;stream['nextAttempt']=now+cadence(key[1]);stream['status']='fetching'
        try:
            interval=key[1];period='5d' if interval=='1m' else '1mo' if interval in ['2m','5m','15m','30m','90m'] else '3mo' if interval=='60m' else '1y'
            market=_load_market_data(validate_request(key[0],interval,period,None,None),live=True).model_dump()
            with _lock:
                fresh_start=market['bars'][0]['time'] if market['bars'] else None
                previous=stream.get('market')
                if previous:
                    old={b['time']:b for b in previous['bars'] if b.get('complete')}
                    ratios=[b['close']/old[b['time']]['close'] for b in market['bars'] if b['time'] in old and old[b['time']]['close']>0]
                    incompatible=len(ratios)>=3 and sum(abs(r-1)>.1 for r in ratios)>=len(ratios)*.8
                    if incompatible:
                        for session in _sessions.values():
                            if session['keys'][0]==key: session.update(active=False,gap=True,error='Adjusted price history changed substantially. Start a new live baseline.')
                        stream.update(status='error',error='Adjusted price baseline changed',permanent=True)
                        continue
                    merged={b['time']:b for b in previous['bars']}
                    merged.update({b['time']:b for b in market['bars']})
                    market['bars']=sorted(merged.values(),key=lambda b:b['time'])[-100000:]
                for session in _sessions.values():
                    if session['active'] and session.get('session') and session['keys'][0]==key:
                        last=session['session']['market']['bars'][session['session']['cursor']]['time']
                        # A rolling window that no longer overlaps the execution snapshot
                        # cannot prove that all missed candles were accounted for.
                        if fresh_start and fresh_start>last and fresh_start>session.get('resumeAfter',0) and not session.get('gap'):
                            session.update(active=False,gap=True,error='The missing history exceeds the provider window. Acknowledge the monitoring gap before resuming.')
                stream.update(market=market,status='current',lastSuccess=time.time(),error=None,failures=0)
                for session in _sessions.values():
                    if not session['active'] or tuple(session['keys'][0])!=key: continue
                    if session.get('session') is None:
                        session['session']=engine('/initialize',{'market':market,'config':session['config']});session['pending']=[]
                    else:
                        result=engine('/live-tick',{'session':session['session'],'market':market,'pending':session['pending'],'resumeAfter':session.get('resumeAfter',0)})
                        session['session']=result['session'];session['pending']=result['pending'];session['rejected']=result.get('rejected',[])
                    session['revision']+=1
                    persist(session)
        except Exception as exc:
            code=exc.status_code if isinstance(exc,HTTPException) else 502
            with _lock:
                stream['failures']=stream.get('failures',0)+1
                stream['status']='throttled' if code==429 else 'error'
                stream['error']=exc.detail if isinstance(exc,HTTPException) else 'Provider request failed'
                stream['permanent']=code in [400,404,422]
                delay=min(900,30*2**min(stream['failures']-1,5))
                if code==429: delay=max(delay,(provider_status()['retryAt'] or 0)-time.time())
                stream['nextAttempt']=time.time()+delay

@router.post('')
def enable(body:dict=Body(...)):
    global _started
    from backend.main import validate_request
    requested=body.get('streams',[])
    if not requested or len(requested)>24: raise HTTPException(422,'Choose 1–24 streams')
    if len({s['ticker'].upper() for s in requested})>6: raise HTTPException(422,'Maximum six unique symbols')
    keys=[]
    for s in requested:
        key=stream_key(s['ticker'],s['interval']);validate_request(key[0],key[1],'1d',None,None)
        if key not in keys: keys.append(key)
    client=str(body.get('client',''))
    if not client: raise HTTPException(422,'Client required')
    with _lock:
        for key in keys:
            _streams.setdefault(key,{'ticker':key[0],'interval':key[1],'nextAttempt':time.time(),'status':'queued'})
        id=str(uuid.uuid4())
        session={'id':id,'keys':keys,'active':True,'gap':False,'leases':{client:time.time()+60},'config':body['config'],'session':None,'pending':[],'revision':1,'controller':client,'resumeAfter':time.time()}
        if body.get('resumeSession'):
            if not engine('/validate',body['resumeSession']).get('valid'): raise HTTPException(422,'Invalid saved live account')
            session['session']=body['resumeSession']
            if body.get('resumeId'):
                import json
                with db() as conn:
                    saved=conn.execute('SELECT payload FROM sessions WHERE id=?',(body['resumeId'],)).fetchone()
                if saved:
                    pending=json.loads(saved['payload']).get('live',{}).get('pending',[])
                    session['pending']=[{**p,'submittedAt':time.time()} for p in pending]
                    session['commands']={p['key']:True for p in pending}
        if session['session'] is None and _streams[keys[0]].get('market'):
            session['session']=engine('/initialize',{'market':_streams[keys[0]]['market'],'config':session['config']})
        _sessions[id]=session
        if not _started: _started=True;threading.Thread(target=_loop,daemon=True,name='replay-live').start()
        return snapshot(session)

def lookup(id):
    session=_sessions.get(id)
    if not session: raise HTTPException(404,'Live workspace expired or server restarted; enable Live again')
    return session

@router.get('/{id}')
def state(id:str):
    with _lock: return snapshot(lookup(id))

@router.post('/{id}/heartbeat')
def heartbeat(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if not session['active']: raise HTTPException(409,'Live paused; explicitly resume and acknowledge the monitoring gap')
        session['leases'][str(body.get('client'))]=time.time()+60
        return {'id':id,'active':True,'revision':session['revision']}

@router.post('/{id}/resume')
def resume(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id);session.update(active=True,gap=False,resumeAfter=time.time(),leases={str(body['client']):time.time()+60})
        for key in session['keys']: _streams[key]['nextAttempt']=time.time()
        return snapshot(session)

@router.delete('/{id}')
def stop(id:str):
    with _lock:
        session=lookup(id);session['active']=False;persist(session)
    return {'active':False}

@router.post('/{id}/orders')
def order(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if not session['active'] or not session['session']: raise HTTPException(409,'Wait for a current active live workspace')
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controlling client can trade')
        validated=engine('/command',{'session':session['session'],'command':body.get('command')})
        key=str(body.get('key',''))
        if not key: raise HTTPException(422,'Idempotency key required')
        session.setdefault('commands',{})
        if key not in session['commands']:
            if len(session['pending'])>=100: raise HTTPException(422,'Pending order limit reached')
            if body['command'].get('type')=='cancel':
                session['session']=validated;session['revision']+=1
            else:
                session['pending'].append({'key':key,'submittedAt':time.time(),'command':body['command']})
            session['commands'][key]=True
            persist(session)
        return {'queued':True,'pending':len(session['pending'])}

@router.put('/{id}/streams')
def update_streams(id:str,body:dict=Body(...)):
    from backend.main import validate_request
    requested=body.get('streams',[])
    if not requested or len(requested)>24 or len({s['ticker'].upper() for s in requested})>6: raise HTTPException(422,'Maximum six symbols and 24 streams')
    keys=list(dict.fromkeys(stream_key(s['ticker'],s['interval']) for s in requested))
    for ticker,interval in keys: validate_request(ticker,interval,'1d',None,None)
    with _lock:
        session=lookup(id)
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controller can change streams')
        if keys[0]!=session['keys'][0]: raise HTTPException(422,'Start a new live workspace to change the trading instrument')
        for key in keys: _streams.setdefault(key,{'ticker':key[0],'interval':key[1],'nextAttempt':time.time(),'status':'queued'})
        session['keys']=keys
        return snapshot(session)

@router.post('/{id}/refresh')
def refresh(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controller can refresh')
        for key in session['keys']:
            _streams[key]['nextAttempt']=time.time();_streams[key]['permanent']=False
        return snapshot(session)

@router.delete('/{id}/orders/{key}')
def cancel_queued(id:str,key:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controller can cancel orders')
        session['pending']=[p for p in session['pending'] if p['key']!=key]
        persist(session)
        return snapshot(session)

@router.get('/{id}/events')
async def events(id:str):
    import asyncio,json
    from fastapi.responses import StreamingResponse
    with _lock: lookup(id)
    async def updates():
        previous=None
        while True:
            with _lock: current=snapshot(lookup(id))
            encoded=json.dumps(current,separators=(',',':'))
            if encoded!=previous:
                yield f'data: {encoded}\n\n';previous=encoded
            else: yield ': heartbeat\n\n'
            await asyncio.sleep(2)
    return StreamingResponse(updates(),media_type='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})
