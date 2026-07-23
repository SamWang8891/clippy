<div align="center">

<img src="logo/logo.png" alt="Logo" width="100">

# Clippy

<img src="https://img.shields.io/badge/Version-v2.0.1-green">

A web-based application that allows users to share text and files in real-time through secure, encrypted sessions.

[台灣繁體中文 請按這](README.zh-TW.md)

</div>

---

## Table of Contents 📖

- [Features ✨](#features-)
- [Screenshots 📸](#screenshots-)
- [Usage 🚀](#usage-)
    - [Installation ⚙️](#installation-)
- [Local Development 🛠](#local-development-)
    - [Running Locally 🚧](#running-locally-)
    - [Building with Docker 🐳](#building-with-docker-)
- [Notes 📝](#notes-)
    - [Known Bugs 🐛](#known-bugs-)
- [Issues / Bugs? 🙋‍♀️](#issues--bugs-)

---

## Features ✨

Tired of sharing text / files across different computers? Try this clippy!

- **Session-based sharing**: Create or join sessions using short, custom-length IDs
- **Encrypted payloads**: Each session uses a 256-bit AES-GCM key derived client-side from the connection ID (SHA-256 KDF). All block content is encrypted before it leaves the browser, so the backend only ever sees ciphertext. The server issues the ID and could derive the key too — this is encrypted-at-rest and on-the-wire, not strict end-to-end against a malicious server
- **Real-time collaboration**: See blocks appear instantly when other users create them
- **File uploads**: Support for small file uploads
- **Curl upload**: Upload text or files from the terminal — host can enable/disable per session
  ```bash
  curl -d 'hello' https://your-host/u/SESSION_ID
  curl -F f=@file.txt https://your-host/u/SESSION_ID
  ```
- **Raw links**: Generate public short links to share decrypted text or files with anyone (e.g. `https://your-host/r/SESSION_ID/CODE`)
- **User management**:
    - Custom or random user names
    - Host can transfer host rights to other users
    - Host can control whether new users can join
- **Session persistence**: Sessions remain active until destroyed by host or after 1 hour of inactivity
- **Block system**: Add and delete text or file blocks, similar to Jupyter notebooks

---

## Screenshots 📸

<img src="readme-image/1.png" width="600" alt="Screenshot 1">
<img src="readme-image/2.png" width="600" alt="Screenshot 2">
<img src="readme-image/3.png" width="600" alt="Screenshot 3">

---

## Usage 🚀

### Installation ⚙️

Requires Docker and Docker Compose.

```bash
mkdir clippy && cd clippy
curl -fsSL https://raw.githubusercontent.com/SamWang8891/clippy/main/docker-compose.prod.yaml -o docker-compose.prod.yaml
curl -fsSL https://raw.githubusercontent.com/SamWang8891/clippy/main/setup.sh -o setup.sh
bash setup.sh
```

The script will prompt you for the base URL, port, upload size limit, and connection ID length, then start the service.

To build from source instead, see [Local Development](#local-development-).

---

## Local Development 🛠

### Prerequisites ✅

- Node >= 22.20.0
- Python >= 3.12

### File Structure 🗄

- **Frontend:** Vite + React, in `frontend/`.
- **Backend:** Python FastAPI, in `backend/`.

### Running Locally 🚧

Run the frontend and backend in separate terminals with hot-reload:

```bash
# Terminal 1: backend
cd backend
cp .env.example .env
pip install -r requirements.txt  # or: uv sync
python app.py

# Terminal 2: frontend
cd frontend
npm install
npm run dev
```

Vite's dev server proxies `/api`, `/ws`, and `/r/` to the backend at `localhost:8123`.

The FastAPI docs are available at `http://localhost:8123/api/v2/docs`.

Note: you may want to set `ALLOWED_ORIGINS=*` in `backend/.env` during development.

### Building with Docker 🐳

To build and run the full Docker image locally:

```bash
docker build -t clippy .
docker run -p 8080:80 --env-file backend/.env clippy
```

---

## Notes 📝

### Known Bugs 🐛

- Destroying the session might not directly take you back to homepage.

---

## Issues / Bugs? 🙋‍♀️

Encounter issues or bugs? Feel free to report them in Issues and submit Pull Requests. For PR, please target dev branch.