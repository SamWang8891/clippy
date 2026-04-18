FROM python:3.14.4-alpine3.23

WORKDIR /app

COPY docker/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Expose the port the app runs on
EXPOSE 8123

CMD [ "python", "./app.py" ]