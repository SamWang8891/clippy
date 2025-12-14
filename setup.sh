#!/bin/bash

# Check current directory
if [ ! -f "docker/frontend/index.html" ] || [ ! -f "docker/backend/app.py" ]; then
    echo "Required files not in docker/, please do download the release.zip from GitHub release page or build it yourself."
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
        docker stop clippy-nginx
        docker stop clippy-python
        docker rm clippy-nginx
        docker rm clippy-python
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


# Check if openssl is installed
if ! command -v openssl &> /dev/null
then
    echo -e "\nOpenSSL not found on your system."
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
sed -i.bak "s|ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${baseurl}|g" docker/backend/.env

# Update backend URL in docker/frontend/config.yaml
sed -i.bak "s|url: \".*\"|url: \"${baseurl}\"|g" docker/frontend/config.yaml


# Get maximum file upload size from user
echo -e "\nPlease enter the maximum file upload size in GiB (Gibibytes)."
echo -e "Note: Some reverse proxies (e.g., Cloudflare) may impose their own file size limits."
echo -e "1 GiB = 1024 MiB. Recommended: 1-5 GiB\n"
read -r -p "Please enter max file size (GiB): " maxfilesize

# Update MAX_UPLOAD_SIZE_GIB in docker/backend/.env
sed -i.bak "s|MAX_UPLOAD_SIZE_GIB=.*|MAX_UPLOAD_SIZE_GIB=${maxfilesize}|g" docker/backend/.env


# Generate secure encryption keys
echo -e "\nGenerating secure encryption keys..."

# Generate random encryption passphrase (64 bytes, base64 encoded)
ENCRYPTION_PASSPHRASE=$(openssl rand -base64 64 | tr -d '\n')
echo "Encryption passphrase generated: ${ENCRYPTION_PASSPHRASE:0:20}... (truncated for display)"

# Generate random encryption salt (32 bytes, base64 encoded)
ENCRYPTION_SALT=$(openssl rand -base64 32 | tr -d '\n')
echo "Encryption salt generated: ${ENCRYPTION_SALT:0:20}... (truncated for display)"

# Update encryption keys in docker/backend/.env
sed -i.bak "s|ENCRYPTION_PASSPHRASE=.*|ENCRYPTION_PASSPHRASE=${ENCRYPTION_PASSPHRASE}|g" docker/backend/.env
sed -i.bak "s|ENCRYPTION_SALT=.*|ENCRYPTION_SALT=${ENCRYPTION_SALT}|g" docker/backend/.env


# Set permission
chmod -R 777 docker


# Docker compose up
docker compose up --build -d


# Finished message
echo -e "\nInstallation finished!"