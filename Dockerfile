FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY engine ./engine
RUN npm run build && npm run build:engine

FROM node:22-bookworm-slim AS engine
WORKDIR /app
COPY --from=frontend --chown=node:node /app/dist-engine ./dist-engine
USER node
ENV ENGINE_PORT=8003 ENGINE_HOST=0.0.0.0
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:8003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-engine/server.cjs"]

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/home/replay REPLAY_DATA_DIR=/data
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 replay \
    && mkdir -p /data && chown replay:replay /data
COPY --chown=replay:replay backend ./backend
COPY --from=frontend --chown=replay:replay /app/dist ./dist
USER replay
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
