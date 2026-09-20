"""One provider gate shared by live polling and historical cache misses."""
import os
import random
from threading import Lock
import time
from fastapi import HTTPException
from yfinance.exceptions import YFRateLimitError
_lock=Lock()
_last_start=0.0
_until=0.0
_streak=0
_success=0
_loaded=False

def status():
    return {'retryAt':_until or None,'throttleStreak':_streak}

def call(fn, **kwargs):
    global _last_start,_until,_streak,_success,_loaded
    with _lock:
        if not _loaded:
            _loaded=True
            if os.environ.get('REPLAY_E2E')!='1':
                try:
                    import json
                    from backend.storage import directory
                    saved=json.loads((directory()/'provider-cooldown.json').read_text())
                    _until=max(_until,float(saved.get('until',0)));_streak=max(_streak,int(saved.get('streak',0)))
                except (OSError,ValueError,TypeError): pass
        now=time.time()
        if now<_until: raise HTTPException(429,'Yahoo Finance cooldown is active',headers={'Retry-After':str(max(1,int(_until-now)))})
        spacing=0 if os.environ.get('REPLAY_E2E')=='1' else 3
        delay=max(0,_last_start+spacing-time.monotonic())
        if delay: time.sleep(delay)
        _last_start=time.monotonic()
        try:
            result=fn(**kwargs)
        except Exception as exc:
            throttled=isinstance(exc,YFRateLimitError) or getattr(getattr(exc,'response',None),'status_code',None)==429 or 'too many requests' in str(exc).lower()
            if throttled:
                _streak+=1;_success=0
                wait=min(900,30*2**min(_streak-1,5));wait+=random.uniform(0,wait*.2)
                retry=getattr(getattr(exc,'response',None),'headers',{}).get('Retry-After')
                try: wait=max(wait,float(retry))
                except (TypeError,ValueError):
                    if retry:
                        try:
                            from email.utils import parsedate_to_datetime
                            wait=max(wait,parsedate_to_datetime(retry).timestamp()-time.time())
                        except (TypeError,ValueError): pass
                _until=time.time()+wait
                if os.environ.get('REPLAY_E2E')!='1':
                    import json
                    from backend.storage import directory
                    path=directory()/'provider-cooldown.json'
                    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps({'until':_until,'streak':_streak}));temporary.replace(path)
                raise HTTPException(429,'Yahoo Finance is rate-limiting requests (throttled)' ,headers={'Retry-After':str(int(wait)+1)}) from exc
            raise
        _success+=1
        if _success>=3:
            _streak=0;_until=0
            if os.environ.get('REPLAY_E2E')!='1':
                from backend.storage import directory
                (directory()/'provider-cooldown.json').unlink(missing_ok=True)
        return result
