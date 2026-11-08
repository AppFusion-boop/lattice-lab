# Multi-stage / optimized build for Lattice Lab on Railway
FROM python:3.12-slim-bookworm

# 1. System packages (stable base layer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. uv binary
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# 3. Environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PORT=8765 \
    HOST=0.0.0.0 \
    LATTICE_REPO_ROOT=/app \
    LATTICE_DATA_DIR=/app/data \
    PATH="/app/server/.venv/bin:$PATH" \
    PYTHONPATH="/app/server"

# 4. Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci

# 5. Pre-install Python dependencies (layer caching)
COPY server/pyproject.toml server/uv.lock server/README.md ./server/
RUN uv sync --directory server --no-dev --frozen --no-install-project

# 6. Copy full codebase
COPY . .

# 7. Install editable package & build frontend
RUN uv sync --directory server --no-dev --frozen && npm run build

# 8. Data directory
# Railway rejects the Dockerfile VOLUME instruction. To keep data across
# deploys, attach a Railway Volume to this service with mount path /app/data.
RUN mkdir -p /app/data

EXPOSE 8765

# 9. Start uvicorn with proxy headers for Railway
CMD ["sh", "-c", "uvicorn lattice_server.main:app --app-dir server --host 0.0.0.0 --port ${PORT:-8765} --proxy-headers --forwarded-allow-ips '*'"]
