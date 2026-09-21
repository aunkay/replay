"""Immutable reusable market datasets and strict OHLCV CSV import."""
import csv
import io
import json
import math
import time
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Body, HTTPException
from backend.storage import db, engine
router=APIRouter(prefix='/api/datasets')
SECONDS={'1m':60,'2m':120,'5m':300,'15m':900,'30m':1800,'60m':3600,'1h':3600,'90m':5400,'1d':86400,'5d':432000,'1wk':604800}

def gaps(market):
    step=SECONDS.get(market['interval'])
    if not step: return []
    return [{'after':a['time'],'before':b['time'],'missingSlots':int((b['time']-a['time'])//step)-1} for a,b in zip(market['bars'],market['bars'][1:]) if b['time']-a['time']>step*1.5][:200]

def store(name,market):
    name=str(name).strip()
    if not name or len(name)>120: raise HTTPException(422,'Dataset name must contain 1–120 characters')
    if not isinstance(market,dict) or not isinstance(market.get('bars'),list) or not 2<=len(market['bars'])<=100000: raise HTTPException(422,'Choose 2–100,000 candles')
    if len(json.dumps(market))>32*1024*1024: raise HTTPException(413,'Dataset exceeds 32 MB')
    if not engine('/validate-market',market).get('valid'): raise HTTPException(422,'Invalid OHLCV dataset')
    id=str(uuid.uuid4())
    with db() as conn: conn.execute('INSERT INTO datasets VALUES(?,?,?,?,?)',(id,name,json.dumps(market),json.dumps(gaps(market)),time.time()))
    return read(id)

@router.get('')
def listing():
    with db() as conn:
        rows=conn.execute('SELECT * FROM datasets ORDER BY updated DESC').fetchall()
    return [{'id':r['id'],'name':r['name'],'ticker':(m:=json.loads(r['market']))['ticker'],'interval':m['interval'],'count':len(m['bars']),'source':m['source'],'range':m['range'],'gapCount':len(json.loads(r['gaps']))} for r in rows]

@router.post('',status_code=201)
def save(body:dict=Body(...)): return store(body.get('name',''),body.get('market'))

@router.post('/import',status_code=201)
def import_csv(body:dict=Body(...)):
    from backend.main import INTERVALS
    text=body.get('csv','');interval=body.get('interval','1d');ticker=str(body.get('ticker','')).strip().upper()
    if not ticker or len(ticker)>32 or interval not in INTERVALS: raise HTTPException(422,'Choose a ticker and supported interval')
    if not isinstance(text,str) or len(text)>20*1024*1024: raise HTTPException(413,'CSV exceeds 20 MB')
    currency=body.get('currency','USD')
    if not isinstance(currency,str) or len(currency)!=3 or not currency.isalpha(): raise HTTPException(422,'Currency must be a three-letter code')
    bars=[]
    try:
        reader=csv.DictReader(io.StringIO(text.lstrip('\ufeff')),strict=True)
        if not reader.fieldnames: raise ValueError('CSV needs a header')
        headers=[h.strip().lower() for h in reader.fieldnames]
        if len(set(headers))!=len(headers): raise ValueError('Duplicate CSV columns')
        reader.fieldnames=headers
        if not {'open','high','low','close','volume'}.issubset(headers) or not any(k in headers for k in ['time','date','datetime']): raise ValueError('Required columns: time (or date), open, high, low, close, volume')
        time_key=next(k for k in ['time','date','datetime'] if k in headers)
        for line,row in enumerate(reader,2):
            if len(bars)>=100000: raise ValueError('Maximum 100,000 candles')
            raw=row[time_key].strip()
            try:
                timestamp=float(raw)
            except ValueError:
                date=datetime.fromisoformat(raw.replace('Z','+00:00'))
                timestamp=date.replace(tzinfo=timezone.utc).timestamp() if date.tzinfo is None else date.timestamp()
            if not math.isfinite(timestamp) or not timestamp.is_integer() or not -2208988800<=timestamp<=7258118400: raise ValueError(f'Row {line}: time must be ISO date/time or Unix seconds (not milliseconds)')
            bar={'time':int(timestamp),**{k:float(row[k]) for k in ['open','high','low','close','volume']},'complete':True}
            if not all(math.isfinite(bar[k]) for k in ['open','high','low','close','volume']) or min(bar['open'],bar['low'],bar['close'])<=0 or bar['high']<max(bar['open'],bar['close']) or bar['low']>min(bar['open'],bar['close']) or bar['volume']<0: raise ValueError(f'Row {line}: invalid OHLCV values')
            if bars and bar['time']<=bars[-1]['time']: raise ValueError(f'Row {line}: timestamps must be increasing and unique')
            if interval in SECONDS: bar['endTime']=bar['time']+SECONDS[interval]
            bars.append(bar)
    except (ValueError,TypeError,KeyError,AttributeError,csv.Error,OverflowError) as exc: raise HTTPException(422,str(exc)) from exc
    if len(bars)<2: raise HTTPException(422,'Import at least two candles')
    market={'ticker':ticker,'name':str(body.get('name') or ticker),'currency':currency.upper(),'exchange':None,'exchangeTimezone':'UTC','interval':interval,'source':'csv','adjusted':False,'fetchedAt':datetime.now(timezone.utc).isoformat(),'range':{'start':datetime.fromtimestamp(bars[0]['time'],timezone.utc).isoformat(),'end':datetime.fromtimestamp(bars[-1]['time'],timezone.utc).isoformat()},'warnings':['Imported prices are used as supplied. Timezone-free dates are interpreted as UTC. Potential gaps may include market closures.'],'bars':bars}
    return store(body.get('name',ticker),market)

@router.get('/{id}')
def read(id:str):
    with db() as conn: row=conn.execute('SELECT * FROM datasets WHERE id=?',(id,)).fetchone()
    if not row: raise HTTPException(404,'Dataset not found')
    return {'id':row['id'],'name':row['name'],'market':json.loads(row['market']),'gaps':json.loads(row['gaps'])}

@router.delete('/{id}')
def delete(id:str):
    with db() as conn: conn.execute('DELETE FROM datasets WHERE id=?',(id,))
    return {'deleted':True}
