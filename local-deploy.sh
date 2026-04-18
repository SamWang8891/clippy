#!/bin/bash
# Local equivalent of .github/workflows/create_release.yaml steps 2-6:
# builds the frontend and populates docker/ so `docker compose up` can run
# against the same layout that the release ZIP ships.
#
# Does NOT run step 7+ (wiping source dirs, zipping, publishing a release).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if [ ! -d "frontend" ] || [ ! -d "backend" ] || [ ! -d "docker" ]; then
    echo "Expected frontend/, backend/, and docker/ at $repo_root." >&2
    echo "Run this script from the repository root." >&2
    exit 1
fi

# Step 2: Install and build web frontend
echo "==> Building web frontend"
(
    cd frontend
    npm install
    npm run build
)

# Step 3: Prepare docker directories with clean templates
echo "==> Resetting docker/backend and docker/frontend (keeping .gitkeep)"
find docker/backend -mindepth 1 ! -name '.gitkeep' -delete
find docker/frontend -mindepth 1 ! -name '.gitkeep' -delete

echo "==> Copying .env and config templates"
cp backend/.env.example docker/backend/.env
cp .env.example .env
cp frontend/public/config.example.yaml docker/frontend/config.yaml

# Step 4: Copy built frontend to docker/frontend
echo "==> Copying frontend build output"
cp -r frontend/dist/. docker/frontend/

# Step 5: Copy backend files to docker/backend
echo "==> Copying backend sources"
cp backend/app.py docker/backend/
cp backend/requirements.txt docker/backend/
mkdir -p docker/backend/uploads

echo
echo "docker/ is ready. Next: run ./setup.sh to configure and start the stack."
