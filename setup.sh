#!/bin/bash
set -euo pipefail

# Check current directory
if [ ! -f "docker/frontend/index.html" ] || [ ! -f "docker/backend/app.py" ]; then
    echo "Required files not in docker/, please download the release.zip from the GitHub release page or build it yourself."
    echo "Please refer to README.md for more info."
    exit 1
fi


# Check if docker is installed
if ! command -v docker &> /dev/null
then
    echo -e "\nDocker not found on your system, or it just simply lacks the sudo power."
    echo "Please install docker."
    exit 1
fi


# Check if existing service is already installed on docker
if [ "$(docker ps -aq -f name=clippy)" ]; then
    echo ""
    read -r -p "There is an existing one, do you want to reinstall and reconfigure it? (yes/no): " confirm
    if [ "$confirm" == "yes" ]; then
        echo -e "\nStopping, please wait patiently..."
        docker stop clippy-nginx || true
        docker stop clippy-python || true
        docker rm clippy-nginx || true
        docker rm clippy-python || true
    else
        echo -e "Exiting...\n"
        exit 1
    fi
fi


# Check if docker compose is installed
if ! command -v docker compose &> /dev/null
then
    echo -e "\nDocker compose not found on your system."
    echo "Please install docker compose."
    exit 1
fi


# Get base URL from user
echo -e "\nPlease enter the base URL for your Clippy installation."
echo -e "This should include the protocol (http:// or https://) and port number if not using standard ports (80/443)."
echo -e "Examples: http://localhost:8080, https://clippy.example.com"
echo -e "If using a reverse proxy, enter the public-facing URL.\n"
read -r -p "Please enter base URL: " baseurl

# Update ALLOWED_ORIGINS in docker/backend/.env
# `sed -i` differs between BSD (macOS) and GNU (Linux); use a temp-file rewrite
# so we don't leave .bak files behind on either platform.
update_in_place() {
    local file=$1
    local expr=$2
    local tmp
    tmp=$(mktemp "${file}.XXXXXX")
    sed "$expr" "$file" > "$tmp"
    mv "$tmp" "$file"
}

update_in_place docker/backend/.env "s|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${baseurl}|g"

# Write the backend URL into the frontend's runtime config (JSON, not YAML).
cat > docker/frontend/config.json <<EOF
{
  "url": "${baseurl}"
}
EOF

# Get docker expose port from user
echo -e "\nPlease enter the port number you want to expose the service on."
read -r -p "Please enter port number: " exporse_port

# Update .env
update_in_place .env "s|WEB_PORT=.*|WEB_PORT=${exporse_port}|g"

# Get maximum file upload size from user
echo -e "\nPlease enter the maximum file upload size in GiB (Gibibytes)."
echo -e "Note: Some reverse proxies (e.g., Cloudflare) may impose their own file size limits."
echo -e "1 GiB = 1024 MiB. Recommended: 1-5 GiB\n"
read -r -p "Please enter max file size (GiB): " maxfilesize

# Update MAX_UPLOAD_SIZE_GIB in docker/backend/.env
update_in_place docker/backend/.env "s|MAX_UPLOAD_SIZE_GIB=.*|MAX_UPLOAD_SIZE_GIB=${maxfilesize}|g"


# Get the connection id length from user
echo -e "\nPlease enter the connection ID length."
echo -e "Note: User will NOT be able to create new connection when all id is taken at the moment."
echo -e "Recommended: 4-6\n"
read -r -p "Please enter the connection ID length: " idlength

# Update CONNECTION_ID_LENGTH in docker/backend/.env
update_in_place docker/backend/.env "s|CONNECTION_ID_LENGTH=.*|CONNECTION_ID_LENGTH=${idlength}|g"


# Encryption keys are generated client-side per session and shared via the URL
# fragment, so the server holds no encryption secret and none is configured here.

# Backend runs as root in-container, so 750/640 still lets it read/write while
# blocking other host users from the .env. Nginx's worker runs as the non-root
# `nginx` user on Linux bind mounts, so the frontend assets and nginx config
# must be world-readable or the worker gets EACCES on index.html.
find docker/backend -type d -exec chmod 750 {} +
find docker/backend -type f -exec chmod 640 {} +
chmod 600 docker/backend/.env
find docker/frontend -type d -exec chmod 755 {} +
find docker/frontend -type f -exec chmod 644 {} +
chmod 755 docker/nginx
chmod 644 docker/nginx/default.conf


# Docker compose up
docker compose up --build -d


# Finished message
echo -e "\nInstallation finished!"
