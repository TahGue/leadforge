# syntax=docker/dockerfile:1.7
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# libxml2/libxslt are needed by lxml and selectolax on slim images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libxml2 libxslt1.1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY services/leadforge ./services/leadforge

# Optional bounded browser rendering (spec 11). Off by default: large image.
ARG INSTALL_BROWSER=false
RUN if [ "$INSTALL_BROWSER" = "true" ]; then \
      pip install --no-cache-dir ".[browser]" && python -m playwright install --with-deps chromium; \
    else \
      pip install --no-cache-dir .; \
    fi

RUN useradd --uid 1001 --create-home worker && mkdir -p /app/data/artifacts /app/data/imports \
    && chown -R worker:worker /app
USER worker

CMD ["python", "-m", "leadforge.worker"]
