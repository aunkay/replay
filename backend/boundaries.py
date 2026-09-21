"""Separate chart labels from the instant candle information becomes available."""
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
import pandas as pd

SECONDS={'1m':60,'2m':120,'5m':300,'15m':900,'30m':1800,'60m':3600,'1h':3600,'90m':5400,'1d':86400,'5d':432000,'1wk':604800}
EXCHANGES={'NMS':'XNYS','NGM':'XNYS','NCM':'XNYS','NYQ':'XNYS','ASE':'XNYS','PCX':'XNYS','BTS':'XNYS','LSE':'XLON','AMS':'XAMS','GER':'XFRA','HKG':'XHKG','JPX':'XTKS','ASX':'XASX','TOR':'XTSE'}

def cadence(interval,now=None):
    now=now or datetime.now(timezone.utc)
    if interval in SECONDS: return SECONDS[interval]/2
    months=1 if interval=='1mo' else 3
    return ((pd.Timestamp(now)+pd.DateOffset(months=months))-pd.Timestamp(now)).total_seconds()/2

def annotate(bars,interval,metadata,ticker):
    now=datetime.now(timezone.utc).timestamp()
    calendar=None
    exchange=EXCHANGES.get(metadata.get('exchangeName'))
    if exchange:
        try:
            import exchange_calendars as xcals
            calendar=xcals.get_calendar(exchange)
        except Exception: pass
    crypto=metadata.get('instrumentType')=='CRYPTOCURRENCY' or ticker.endswith('-USD') and metadata.get('exchangeName')=='CCC'
    zone=metadata.get('exchangeTimezoneName','UTC')
    try: tz=ZoneInfo(zone)
    except Exception: tz=timezone.utc
    for i,bar in enumerate(bars):
        start=datetime.fromtimestamp(bar.time,timezone.utc)
        end=None
        if interval in SECONDS and SECONDS[interval]<86400:
            end=bar.time+SECONDS[interval]
            if calendar:
                try:
                    day=pd.Timestamp(start.astimezone(tz).date())
                    if calendar.is_session(day):
                        opened=calendar.session_open(day).timestamp();closed=calendar.session_close(day).timestamp()
                        bar.session='premarket' if bar.time<opened else 'afterhours' if bar.time>=closed else 'regular'
                        if opened<=bar.time<closed: end=min(end,closed)
                except Exception: pass
        elif calendar:
            try:
                day=pd.Timestamp(start.date())
                if interval=='1d': last=day
                elif interval=='5d': last=calendar.sessions_window(calendar.date_to_session(day,direction='next'),4)[-1]
                elif interval=='1wk': last=day+pd.Timedelta(days=6-day.dayofweek)
                else: last=day+pd.DateOffset(months=1 if interval=='1mo' else 3)-pd.Timedelta(days=1)
                last=calendar.date_to_session(last,direction='previous')
                end=calendar.session_close(last).timestamp()
            except Exception: pass
        elif crypto:
            end=(pd.Timestamp(start)+pd.DateOffset(months=1 if interval=='1mo' else 3)).timestamp() if interval in ['1mo','3mo'] else bar.time+SECONDS[interval]
        if end is None and i+1<len(bars): end=bars[i+1].time
        bar.endTime=int(end) if end else None
        bar.complete=bool(end and now>=end)
    return bars
