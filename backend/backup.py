"""python -m backend.backup /backup/replay.zip (consistent SQLite snapshot)."""
import argparse
from pathlib import Path
import sqlite3
import tempfile
import zipfile
from backend.storage import directory,db

def backup(destination:Path):
    with tempfile.TemporaryDirectory() as temporary:
        snapshot=Path(temporary)/'replay.sqlite'
        with db() as source,sqlite3.connect(snapshot) as target: source.backup(target)
        destination.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.write(snapshot,'replay.sqlite')
            cooldown=directory()/'provider-cooldown.json'
            if cooldown.exists(): archive.write(cooldown,cooldown.name)
    return destination

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('destination',type=Path)
    print(backup(parser.parse_args().destination))
