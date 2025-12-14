# Simple URL Shortener

A web-based application that allows users to share text and files in real-time through secure, encrypted sessions.

[台灣繁體中文 請按這](README.zh-TW.md)

---

## Table of Contents 📖

- [Features ✨](#features-)
- [Screenshots 📸](#screenshots-)
- [Usage 🚀](#usage-)
    - [Installation ⚙️](#installation-)
    - [Setting the Rate Limit 🕒](#setting-the-rate-limit-)
    - [Changing the Default Port 🔌](#changing-the-default-port-)
- [Build It Yourself 🛠](#build-it-yourself-)
    - [File Structure 🗄](#file-structure-)
    - [Prerequisites ✅](#prerequisites-)
    - [Building 🚧](#building-)
- [Notes 📝](#notes-)
    - [Known Bugs 🐛](#known-bugs-)
- [Issues / Bugs? 🙋‍♀️](#issues--bugs-)

---

## Features ✨

Tired of sharing text / files across different computers? Try this clippy! 

- **Session-based sharing**: Create or join sessions using simple 6-character IDs
- **End-to-end encryption**: All text and files are encrypted client-side before transmission
- **Real-time collaboration**: See blocks appear instantly when other users create them
- **File uploads**: Support for file uploads up to 1 GiB (configurable)
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

1. Download the release ZIP file from the release page. To build it yourself, please refer
   to [Build It Yourself](#build-it-yourself-).
2. Unzip the file.
3. Run the setup script:
   ```bash
   bash setup.sh

   # If Docker requires root permission
   sudo bash setup.sh
   ```
4. Follow the prompts to enter variables and parameters.
5. You're all set!

### Setting the Rate Limit 🕒

The rate limit is set in nginx.
Default setting allows 10 requests per minute.
You can modify the limit in
`docker/nginx/nginx.conf`.

### Changing the Default Port 🔌

By default, the web service runs on port 8080. To change it, edit the `.env` file of the project root.

---

## Build It Yourself 🛠

### File Structure 🗄

#### Source Code 🧑‍💻

- **Frontend:** Built using Vite, located in the `frontend` folder.
- **Backend:** Built using Python FastAPI, located in the `backend` folder.

#### Docker 🐳

- `docker/frontend`: Contains built frontend files.
- `docker/backend`: Contains Python backend files.
- `docker/nginx`: Contains Nginx `default.conf`.

### Prerequisites ✅

1. Node.js >= 22.20.0
2. Python >= 3.9.6

### Building 🚧

#### Frontend 🌐

1. Navigate to the `frontend` folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Modify the code as you wish.
4. (Optional) Vite can be executed in development mode:
   ```bash
   npm run dev
   ```
5. Build the frontend:
   ```bash
   npm run build
   ```
6. Copy the files under `dist` folder to `docker/frontend/`.

#### Backend 👨‍🔧

The FastAPI documentation is in https://example.com/api/v1/docs.

The passphrase and salt is stored in the `docker/backend/.env` file.

If you want to modify the backend, follow these steps. Otherwise, copy the contents of `backend` to `docker/`.

1. Navigate to the `backend` folder.
2. (Optional) Create a virtual environment:
    By using venv
    ```bash
    python -m venv .venv
    ```
    OR by using uv
    ```bash
    uv venv
    ```
3. (Skip if not using a virtual environment) Activate the virtual environment:
   ```bash
    source .venv/bin/activate
    ```
4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   OR by using uv
    ```bash
   uv sync
    ```
5. Modify the code as you wish.
6. Run the backend in development mode:
   ```bash
   python app.py
   ```
7. Copy the files under `backend` folder to `docker/backend/`.

Note that you might want to change `ALLOWED_ORIGINS` of python .env to `*` when developing.

---

## Notes 📝

### Known Bugs 🐛

- Destroying the session might not directly take you back to homepage.

---

## Issues / Bugs? 🙋‍♀️

Encounter issues or bugs? Feel free to report them in Issues and submit Pull Requests, please open an issue before
typing to do pr.