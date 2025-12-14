#!/bin/bash

echo "Building Clippy for Docker deployment..."

# Check if we're in the right directory
if [ ! -f "docker-compose.yaml" ]; then
    echo "Error: Please run this script from the project root directory"
    exit 1
fi

# Build frontend
echo -e "\n[1/3] Building frontend..."
cd frontend
npm install
npm run build
cd ..

# Copy frontend build to docker/frontend
echo -e "\n[2/3] Copying frontend build to docker/frontend/..."
rm -rf docker/frontend/*
cp -r frontend/dist/* docker/frontend/
echo "Frontend files copied to docker/frontend/"

# Copy backend files to docker/backend
echo -e "\n[3/3] Copying backend files to docker/backend/..."
cp backend/app.py docker/backend/
cp backend/requirements.txt docker/backend/
cp backend/.env docker/backend/.env
cp backend/config.yaml docker/backend/config.yaml
echo "Backend files copied to docker/backend/"

# Verify critical files exist
if [ ! -f "docker/frontend/index.html" ] || [ ! -f "docker/backend/app.py" ]; then
    echo -e "\nError: Build failed - required files missing"
    exit 1
fi

echo -e "\nBuild complete! You can now run ./setup.sh to configure and deploy."
