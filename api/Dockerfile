# Cloud Run image. Python 3.12 has prebuilt wheels for the whole stack.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# requirements.txt resolved, with the lockfile as CONSTRAINTS.
#
# Not `-r requirements.lock.txt`. The lock is generated on Windows, and a
# straight install of it would carry that platform's resolution onto Linux:
# `uvicorn[standard]` pulls uvloop here and cannot there, so the frozen list
# silently omits it and the image would run on the slower event loop. Given as
# constraints, pip resolves the extras correctly for this platform and is still
# pinned to the exact versions the lock records for everything in it.
COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c requirements.lock.txt

COPY app ./app

# Cloud Run provides $PORT (default 8080).
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
