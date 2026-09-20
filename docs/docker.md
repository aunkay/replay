# Docker deployment

Install Docker Engine and the Docker Compose plugin. From the repository root:

```bash
docker compose up -d --build --wait
```

Open **http://localhost:8080** on the host, or **http://YOUR_PC_ADDRESS:8080** from another device on your network. Compose starts the API/frontend service and a private Node simulation worker. The engine has no published host port. It runs as a non-root user and includes an API health check.

The default binding allows access from your network. To restrict it to this PC or change ports, create an untracked `.env` file:

```dotenv
REPLAY_BIND_ADDRESS=127.0.0.1
REPLAY_PORT=8080
```

Re-run `docker compose up -d --wait` after changing these settings. For internet access, use an HTTPS reverse proxy with authentication; Replay does not provide user accounts.

## Start when the PC boots

On Linux with systemd, enable Docker once:

```bash
sudo systemctl enable --now docker
```

Compose configures `restart: unless-stopped`, so an existing running Replay container comes back when Docker starts, including after a reboot. It also restarts after an unexpected process exit. A deliberate `docker compose stop` keeps it stopped across reboots until you start it again. `docker compose down` removes the container; run `docker compose up -d --wait` to restore it.

No separate application systemd unit or login session is needed. This follows [Docker's restart-policy guidance](https://docs.docker.com/engine/containers/start-containers-automatically/). On Docker Desktop, enable Docker Desktop's start-at-login setting instead.

## Update and inspect

```bash
git pull --ff-only
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100
curl http://localhost:8080/api/health
```

Server sessions, trades, journal screenshots and strategy runs live in SQLite in the `replay-data` volume mounted at `/data`. Normal container rebuilds preserve it. Do not use `docker compose down -v` unless you intend to delete this library. Unsaved browser workspaces still depend on the browser and URL origin; use **Import existing browser session** to move one into the library.

Create a consistent backup while the app is running:

```bash
docker compose exec replay python -m backend.backup /data/backup.zip
docker compose cp replay:/data/backup.zip ./replay-backup.zip
```

To restore on this deployment, first retain a current backup. Stop only Replay, extract `replay.sqlite` and the optional `provider-cooldown.json` from the chosen backup, then copy them into the stopped app container's `/data` directory. Remove old `replay.sqlite-wal` and `replay.sqlite-shm` files before replacement (with the app stopped). Start with `docker compose up -d --wait`. Keep restored files writable by UID/GID 10001. Alternatively use individual session ZIP import in the UI without stopping the app.

Live polling always requires explicit activation after a restart; stored paper accounts can be resumed from the library. Yahoo cooldown state also survives restarts.

The health check reports API availability. Restart policies handle process exits, but do not restart a still-running container merely because it becomes unhealthy.
