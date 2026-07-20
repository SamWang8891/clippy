#!/bin/bash
# Build from source and run locally using the dev docker-compose.yaml.
# For production (prebuilt image), use setup.sh instead.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if [ ! -d "frontend" ] || [ ! -d "backend" ] || [ ! -d "docker" ]; then
    echo "Expected frontend/, backend/, and docker/ at $repo_root." >&2
    echo "Run this script from the repository root." >&2
    exit 1
fi

echo "==> Building frontend"
(cd frontend && npm install && npm run build)

echo "==> Preparing docker/ directories"
find docker/backend -mindepth 1 ! -name '.gitkeep' -delete
find docker/frontend -mindepth 1 ! -name '.gitkeep' -delete

cp backend/.env.example docker/backend/.env
cp .env.example .env
cp frontend/public/config.example.yaml docker/frontend/config.yaml

echo "==> Copying build artifacts"
cp -r frontend/dist/. docker/frontend/
cp backend/app.py docker/backend/
cp backend/requirements.txt docker/backend/
mkdir -p docker/backend/uploads

echo "==> Starting with docker compose"
docker compose up --build -d

echo ""
echo "Dev server running at http://localhost:${WEB_PORT:-8080}"
