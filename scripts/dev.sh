#!/usr/bin/env bash
set -Eeuo pipefail

replay_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
replay_python="$replay_root/.venv/bin/python"

if [[ ! -x "$replay_python" ]]; then
  cat >&2 <<'EOF'
Missing .venv. From the repository root, run:
  python3 -m venv .venv
  .venv/bin/python -m pip install -r requirements.txt
  npm install
Then run ./scripts/dev.sh again.
EOF
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is missing. Install Node.js 22 or newer, then run npm install.' >&2
  exit 1
fi

if [[ ! -x "$replay_root/node_modules/.bin/vite" ]]; then
  echo 'Frontend dependencies are missing. Run npm install from the repository root.' >&2
  exit 1
fi

# Separate process groups let cleanup include Vite/npm and Uvicorn's reloader
# children. The launcher also stops the sibling when either server exits.
exec "$replay_python" - "$replay_root" <<'PY'
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(sys.argv[1])
children = []
stop_requested = False
exit_code = 0


def request_stop(signum, _frame):
    global stop_requested, exit_code
    stop_requested = True
    exit_code = 128 + signum


def signal_group(child, signum):
    try:
        os.killpg(child.pid, signum)
    except ProcessLookupError:
        pass


signal.signal(signal.SIGINT, request_stop)
signal.signal(signal.SIGTERM, request_stop)

try:
    print('Replay: http://localhost:5173 | API: http://127.0.0.1:8000', flush=True)
    print('Press Ctrl+C to stop both servers.', flush=True)
    commands = [
        [sys.executable, '-m', 'uvicorn', 'backend.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000'],
        ['npm', 'run', 'dev', '--', '--port', '5173', '--strictPort'],
    ]
    for command in commands:
        if stop_requested:
            break
        children.append(subprocess.Popen(command, cwd=root, start_new_session=True))
    while not stop_requested:
        for child in children:
            result = child.poll()
            if result is not None:
                exit_code = result if result >= 0 else 128 - result
                stop_requested = True
                break
        if not stop_requested:
            time.sleep(0.2)
except OSError as exc:
    print(f'Could not start development servers: {exc}', file=sys.stderr)
    exit_code = 1
finally:
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    for child in children:
        signal_group(child, signal.SIGTERM)
    deadline = time.monotonic() + 5
    for child in children:
        try:
            child.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            pass
    # npm may exit before its Vite child, so check the group even if the parent
    # has already exited. This also handles a stalled reload worker.
    for child in children:
        signal_group(child, signal.SIGKILL)
    for child in children:
        child.wait()

sys.exit(exit_code)
PY
