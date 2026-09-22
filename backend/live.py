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

def stream_key(ticker,interval,extended=False): return (ticker.upper(),'60m' if interval=='1h' else interval,bool(extended))

def persist(session):
    if not session.get('session'): return
    import json
    snapshot=copy.deepcopy(session['session']);snapshot['mode']='live'
    payload=json.dumps({'session':snapshot,'live':{'active':session['active'],'gap':session['gap'],'background':session.get('background',False),'resumeAfter':session.get('resumeAfter',0),'controller':session.get('controller'),'error':session.get('error'),'streams':[{'ticker':key[0],'interval':key[1],'extendedHours':key[2]} for key in session['keys']],'pending':session['pending']}})
    with db() as conn:
        from backend.notifications import enqueue
        old=conn.execute('SELECT payload FROM sessions WHERE id=?',(session['id'],)).fetchone()
        if old:
            enqueue(conn,session['id'],snapshot,json.loads(old['payload'])['session'])
        conn.execute('INSERT INTO sessions(id,name,revision,payload,updated) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=sessions.revision+1,updated=excluded.updated',(session['id'],f"Live {session['keys'][0][0]}",1,payload,time.time()))

def snapshot(session):
    return {k:copy.deepcopy(v) for k,v in session.items() if k not in ['leases','pending','commands']} | {'streams':[copy.deepcopy(_streams[k]) for k in session['keys'] if k in _streams],'provider':provider_status(),'pendingOrders':copy.deepcopy(session['pending'])}

def execution_time(session,key):
    """Last observed timestamp for a traded stream (not an analysis-only pane)."""
    snapshot=session.get('session')
    if not snapshot: return None
    if tuple(session['keys'][0])==key:
        return snapshot['market']['bars'][snapshot['cursor']]['time']
    portfolio=snapshot.get('portfolio')
    if portfolio:
        for market in portfolio['markets']:
            if stream_key(market['ticker'],market['interval'],market.get('extendedHours',False))==key:
                return next(a['bar']['time'] for a in portfolio['book']['assets'] if a['ticker']==market['ticker'])
    return None

def pause_missing_history(session,key,fresh_start):
    last=execution_time(session,key)
    if session['active'] and last is not None and fresh_start and fresh_start>last and fresh_start>session.get('resumeAfter',0) and not session.get('gap'):
        session.update(active=False,gap=True,error='The missing history exceeds the provider window. Acknowledge the monitoring gap before resuming.')
        persist(session)

def _loop():
    from backend.main import _load_market_data,validate_request
    while True:
        time.sleep(.25)
        now=time.time()
        with _lock:
            for session in _sessions.values():
                if session['active'] and not session.get('background') and not any(expiry>now for expiry in session['leases'].values()):
                    session['active']=False;session['gap']=True;persist(session)
            wanted={k for session in _sessions.values() if session['active'] for k in session['keys']}
            due=[k for k in wanted if _streams[k]['nextAttempt']<=now and not _streams[k].get('permanent')]
            if not due: continue
            key=min(due,key=lambda k:(_streams[k]['nextAttempt'],_streams[k].get('lastAttempt',0)))
            stream=_streams[key];stream['lastAttempt']=now;stream['nextAttempt']=now+cadence(key[1]);stream['status']='fetching'
        try:
            interval=key[1];period='5d' if interval=='1m' else '1mo' if interval in ['2m','5m','15m','30m','90m'] else '3mo' if interval=='60m' else '1y'
            from dataclasses import replace
            market=_load_market_data(replace(validate_request(key[0],interval,period,None,None),extended_hours=key[2]),live=True).model_dump()
            with _lock:
                fresh_start=market['bars'][0]['time'] if market['bars'] else None
                previous=stream.get('market')
                if previous:
                    old={b['time']:b for b in previous['bars'] if b.get('complete')}
                    ratios=[b['close']/old[b['time']]['close'] for b in market['bars'] if b['time'] in old and old[b['time']]['close']>0]
                    incompatible=len(ratios)>=3 and sum(abs(r-1)>.1 for r in ratios)>=len(ratios)*.8
                    if incompatible:
                        for session in _sessions.values():
                            if execution_time(session,key) is not None:
                                session.update(active=False,gap=True,error='Adjusted price history changed substantially. Start a new live baseline.');persist(session)
                        stream.update(status='error',error='Adjusted price baseline changed',permanent=True)
                        continue
                    merged={b['time']:b for b in previous['bars']}
                    merged.update({b['time']:b for b in market['bars']})
                    market['bars']=sorted(merged.values(),key=lambda b:b['time'])[-100000:]
                for session in _sessions.values():
                    pause_missing_history(session,key,fresh_start)
                stream.update(market=market,status='current',lastSuccess=time.time(),error=None,failures=0)
                for session in _sessions.values():
                    if not session['active']: continue
                    portfolio=session.get('session',{}).get('portfolio') if session.get('session') else None
                    portfolio_keys={stream_key(m['ticker'],m['interval'],m.get('extendedHours',False)) for m in portfolio['markets']} if portfolio else set()
                    if tuple(session['keys'][0])!=key and key not in portfolio_keys: continue
                    if session.get('session') is None:
                        session['session']=engine('/initialize',{'market':market,'config':session['config']});session['pending']=[]
                    else:
                        base_market=_streams[session['keys'][0]].get('market')
                        if not base_market: continue
                        comparison_markets=[_streams[k]['market'] for k in portfolio_keys if _streams.get(k,{}).get('market')]
                        finer=session['session'].get('finerMarket')
                        finer_key=stream_key(finer['ticker'],finer['interval'],base_market.get('extendedHours',False)) if finer else None
                        finer_market=_streams.get(finer_key,{}).get('market') if finer_key else None
                        result=engine('/live-tick',{'session':session['session'],'market':base_market,'comparisonMarkets':comparison_markets,'finerMarket':finer_market,'pending':session['pending'],'resumeAfter':session.get('resumeAfter',0)})
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

def recover_background():
    """Recover only explicitly opted-in active monitors. Ordinary Live stays off."""
    global _started
    import json
    with _lock:
        with db() as conn:
            rows=conn.execute('SELECT id,revision,payload FROM sessions').fetchall()
        for row in rows:
            payload=json.loads(row['payload']);saved=payload.get('live',{})
            if not saved.get('background') or row['id'] in _sessions: continue
            keys=[stream_key(s['ticker'],s['interval'],s.get('extendedHours',False)) for s in saved['streams']]
            account=payload['session']
            for key in keys:
                _streams.setdefault(key,{'ticker':key[0],'interval':key[1],'extendedHours':key[2],'nextAttempt':time.time(),'status':'queued'})
            # Keep original eligibility times. Fetch overlap before processing
            # missed completed bars; the loop pauses if coverage cannot be proven.
            pending=saved.get('pending',[])
            _sessions[row['id']]={'id':row['id'],'keys':keys,'active':bool(saved.get('active')),'background':True,'gap':bool(saved.get('gap')),'error':saved.get('error'),'leases':{},'config':account['account']['config'],'session':account,'pending':pending,'commands':{p['key']:True for p in pending},'revision':row['revision'],'controller':saved.get('controller'),'resumeAfter':saved.get('resumeAfter',0)}
        if _sessions and not _started:
            _started=True;threading.Thread(target=_loop,daemon=True,name='replay-live').start()

@router.get('')
def list_background():
    with _lock:
        return [{'id':s['id'],'ticker':s['keys'][0][0],'interval':s['keys'][0][1],'active':s['active'],'gap':s['gap'],'error':s.get('error'),'events':len((s.get('session') or {}).get('alertEvents',[]))} for s in _sessions.values() if s.get('background')]

@router.put('/{id}/background')
def background(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controller can change background monitoring')
        if not isinstance(body.get('enabled'),bool): raise HTTPException(422,'Choose enabled or disabled')
        if not session.get('session'): raise HTTPException(409,'Wait for the first completed candle before enabling background monitoring')
        if body['enabled'] and not session['active']: raise HTTPException(409,'Acknowledge the monitoring gap before enabling background monitoring')
        session['background']=body['enabled'];session['revision']+=1;persist(session)
        return snapshot(session)

@router.post('/{id}/connect')
def connect(id:str,body:dict=Body(...)):
    client=str(body.get('client','')).strip()
    if not client: raise HTTPException(422,'Client required')
    with _lock:
        session=lookup(id)
        if not session.get('background'): raise HTTPException(409,'This monitor is not running in the background')
        session['controller']=client;session['leases'][client]=time.time()+60;session['revision']+=1;persist(session)
        return snapshot(session)

@router.post('')
def enable(body:dict=Body(...)):
    global _started
    from backend.main import validate_request
    requested=body.get('streams',[])
    if not requested or len(requested)>24: raise HTTPException(422,'Choose 1–24 streams')
    if len({s['ticker'].upper() for s in requested})>6: raise HTTPException(422,'Maximum six unique symbols')
    keys=[]
    for s in requested:
        key=stream_key(s['ticker'],s['interval'],s.get('extendedHours',False));validate_request(key[0],key[1],'1d',None,None)
        if key not in keys: keys.append(key)
    client=str(body.get('client',''))
    if not client: raise HTTPException(422,'Client required')
    with _lock:
        for key in keys:
            _streams.setdefault(key,{'ticker':key[0],'interval':key[1],'extendedHours':key[2],'nextAttempt':time.time(),'status':'queued'})
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
        persist(session)
        return snapshot(session)

@router.delete('/{id}')
def stop(id:str):
    with _lock:
        session=lookup(id);session['active']=False;session['background']=False;persist(session)
    return {'active':False}

@router.post('/{id}/orders')
def order(id:str,body:dict=Body(...)):
    with _lock:
        session=lookup(id)
        if not session['active'] or not session['session']: raise HTTPException(409,'Wait for a current active live workspace')
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controlling client can trade')
        key=str(body.get('key',''))
        if not key: raise HTTPException(422,'Idempotency key required')
        session.setdefault('commands',{})
        if key in session['commands']: return {'queued':True,'pending':len(session['pending'])}
        command=body.get('command') or {}
        if command.get('type')=='portfolio-add':
            requested=command.get('market') or {}
            portfolio_key=stream_key(requested.get('ticker',''),session['session']['market']['interval'],session['session']['market'].get('extendedHours',False))
            provider_market=_streams.get(portfolio_key,{}).get('market') if portfolio_key in session['keys'] else None
            if not provider_market: raise HTTPException(409,'Add this ticker as a chart comparison and wait for its Live data before trading it.')
            provider_market=copy.deepcopy(provider_market)
            provider_market['bars']=[b for b in provider_market['bars'] if b.get('complete') is True]
            command={**command,'market':provider_market}
            body={**body,'command':command}
        immediate=command.get('type') in ('cancel','alert','portfolio-add','finer-data')
        validated=engine('/command' if immediate else '/validate-live-command',{'session':session['session'],'command':command})
        if command.get('type')=='finer-data' and command.get('market'):
            finer=validated['finerMarket']
            finer_key=stream_key(finer['ticker'],finer['interval'],session['session']['market'].get('extendedHours',False))
            if finer_key not in session['keys'] and len(session['keys'])>=24: raise HTTPException(422,'Maximum 24 streams; remove a chart stream first')
            if finer_key not in session['keys']: session['keys'].append(finer_key)
            _streams.setdefault(finer_key,{'ticker':finer_key[0],'interval':finer_key[1],'extendedHours':finer_key[2],'nextAttempt':time.time(),'status':'queued'})
        key=str(body.get('key',''))
        if not key: raise HTTPException(422,'Idempotency key required')
        session.setdefault('commands',{})
        if key not in session['commands']:
            if not immediate and len(session['pending'])>=100: raise HTTPException(422,'Pending order limit reached')
            if body['command'].get('type') in ('cancel','alert','portfolio-add','finer-data'):
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
    keys=list(dict.fromkeys(stream_key(s['ticker'],s['interval'],s.get('extendedHours',False)) for s in requested))
    for ticker,interval,extended in keys: validate_request(ticker,interval,'1d',None,None)
    with _lock:
        session=lookup(id)
        if body.get('client')!=session['controller']: raise HTTPException(409,'Only the controller can change streams')
        if keys[0]!=session['keys'][0]: raise HTTPException(422,'Start a new live workspace to change the trading instrument')
        portfolio=(session.get('session') or {}).get('portfolio')
        if portfolio:
            keys=list(dict.fromkeys(keys+[stream_key(m['ticker'],m['interval'],m.get('extendedHours',False)) for m in portfolio['markets']]))
            if len(keys)>24 or len({k[0] for k in keys})>6: raise HTTPException(422,'Portfolio holdings count toward the six-symbol limit')
        finer=(session.get('session') or {}).get('finerMarket')
        if finer:
            keys=list(dict.fromkeys(keys+[stream_key(finer['ticker'],finer['interval'],session['session']['market'].get('extendedHours',False))]))
            if len(keys)>24: raise HTTPException(422,'Finer execution counts toward the 24-stream limit')
        for key in keys: _streams.setdefault(key,{'ticker':key[0],'interval':key[1],'extendedHours':key[2],'nextAttempt':time.time(),'status':'queued'})
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
