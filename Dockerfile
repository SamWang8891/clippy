FROM node:22-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.14.4-alpine3.23
RUN apk add --no-cache nginx

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app.py ./

COPY docker/nginx/default.conf /etc/nginx/http.d/default.conf
RUN sed -i 's/clippy-python/127.0.0.1/g' /etc/nginx/http.d/default.conf
COPY --from=frontend-build /build/dist /web

EXPOSE 80
CMD ["sh", "-c", "nginx && python app.py"]
