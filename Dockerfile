# ENGRAM is standard-library only, so the image is tiny and the build is fast.
FROM python:3.12-slim

WORKDIR /app
COPY . .

# Default DB location; attach a Railway volume at /data to persist the ledger
# across deploys (optional — the app auto-seeds a demo on an empty database).
ENV ENGRAM_DB_PATH=/data/engram.sqlite3

# Railway injects $PORT; server.py binds 0.0.0.0:$PORT when PORT is set.
EXPOSE 8787
CMD ["python", "server.py"]
