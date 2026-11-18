# Docker

Compose definitions, image builds and shared container conventions.

## Conventions

- Pinned tags (digests in production), never `latest`.
- `restart: unless-stopped`, healthcheck, log rotation, resource limits on every service.
- Ports bound to `127.0.0.1` in development; no database or cache port published in production.
- Containers run as non-root with a read-only root filesystem where possible.
- Secrets via Docker secrets / mounted files, never via image layers or committed env files.

Root [`docker-compose.yml`](../../docker-compose.yml) is the source of truth for the development stack.
