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

# Run unprivileged. nginx needs to own its runtime dirs and bind :80, which on
# Alpine's nginx works via the existing `nginx` user plus cap_net_bind_service.
RUN mkdir -p /app/data /var/lib/nginx/tmp /var/lib/nginx/logs /run/nginx \
    && chown -R nginx:nginx /app /var/lib/nginx /run/nginx /var/log/nginx \
    && sed -i 's/^user .*/user nginx;/' /etc/nginx/nginx.conf \
    && apk add --no-cache libcap \
    && setcap 'cap_net_bind_service=+ep' /usr/sbin/nginx \
    && apk del libcap
USER nginx

EXPOSE 80
# `exec` so python becomes PID 1 and receives SIGTERM from `docker stop`.
# Without it, `sh` holds PID 1, never forwards the signal, and the container is
# SIGKILLed after the 10s grace period — skipping the lifespan shutdown flush
# and losing whatever session state had not yet been persisted.
CMD ["sh", "-c", "nginx; exec python app.py"]
