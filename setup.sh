#!/bin/bash
set -euo pipefail

# Check if docker + compose are available
for cmd in docker "docker compose"; do
    if ! command -v ${cmd%% *} &> /dev/null; then
        echo "$cmd not found. Please install Docker."
        exit 1
    fi
done

# Handle existing installation
if [ "$(docker ps -aq -f name=clippy)" ]; then
    echo ""
    read -r -p "Existing Clippy found. Reinstall? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Exiting..."
        exit 1
    fi
    echo "Stopping existing containers..."
    docker compose -f docker-compose.prod.yaml down 2>/dev/null || true
fi

# Get base URL
echo ""
echo "Enter the base URL for your Clippy installation."
echo "Include protocol and port if non-standard (e.g. http://localhost:8080, https://clippy.example.com)"
echo ""
read -r -p "Base URL: " baseurl

# Get expose port
echo ""
read -r -p "Port to expose (default 8080): " expose_port
expose_port=${expose_port:-8080}

# Get max upload size
echo ""
echo "Max file upload size in GiB (default 1)."
read -r -p "Max file size (GiB): " maxfilesize
maxfilesize=${maxfilesize:-1}

# Get connection ID length
echo ""
echo "Connection ID length (default 6, recommended 4-6)."
read -r -p "ID length: " idlength
idlength=${idlength:-6}

# Write config.json for frontend
cat > config.json <<EOF
{"url": "${baseurl}"}
EOF

# Write .env
# No ENCRYPTION_PASSPHRASE/SALT: the backend never read them. They implied a
# server-held secret protecting stored data, when the key is actually derived
# from the connection ID (see frontend/src/utils/encryption.js).
cat > .env <<EOF
WEB_PORT=${expose_port}
MAX_UPLOAD_SIZE_GIB=${maxfilesize}
MAX_CURL_UPLOAD_MIB=64
SESSION_TIMEOUT_SECONDS=3600
CONNECTION_ID_LENGTH=${idlength}
RAW_LINK_TTL_SECONDS=600
ALLOWED_ORIGINS=${baseurl}
EOF
chmod 600 .env

# Start — pull explicitly so a reinstall picks up a newer :latest rather than
# silently reusing whatever image is already cached locally.
docker compose -f docker-compose.prod.yaml pull
docker compose -f docker-compose.prod.yaml up -d

echo ""
echo "Clippy is running at ${baseurl}"
