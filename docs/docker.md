# Docker deployment

Install Docker Engine and the Docker Compose plugin. From the repository root:

```bash
docker compose up -d --build --wait
```

Open **http://localhost:8080** on the host, or **http://YOUR_PC_ADDRESS:8080** from another device on your network. The production image builds the frontend and serves it with the API from one origin. It runs as a non-root user and includes an API health check.

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

Session data, paper trades, and chart settings live in browser storage, not the container. Rebuilding the container preserves those settings as long as you use the same browser and URL origin. Moving from development port 5173 to port 8080 starts a separate browser workspace. The server's market-data cache is temporary; no database volume is required.

The health check reports API availability. Restart policies handle process exits, but do not restart a still-running container merely because it becomes unhealthy.
