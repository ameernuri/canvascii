# Production Deploy

Canvascii production is split into two services:

- `apps/canvascii` on Vercel
- `apps/canvascii-collab` on DigitalOcean App Platform

The realtime collab service is a separate websocket server. Vercel hosts the Next.js app, but not the standalone Hocuspocus process.

## Source of truth

- GitHub repo: `https://github.com/ameernuri/canvascii`
- Vercel project: `ameer-nuris-projects/canvascii`
- DigitalOcean app: `canvascii-collab`

Both production services are expected to deploy from the same `main` branch.

## Required production env

### Vercel app

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `NEXT_PUBLIC_CANVASCII_COLLAB_URL`

Recommended values:

- `BETTER_AUTH_URL=https://canvascii.com`
- `BETTER_AUTH_TRUSTED_ORIGINS=https://canvascii.com,https://www.canvascii.com`
- `NEXT_PUBLIC_CANVASCII_COLLAB_URL=wss://<public-collab-host>`

### Collab service

- `DATABASE_URL`
- `CANVASCII_COLLAB_PORT`
- `CANVASCII_COLLAB_HEALTH_PORT`
- `CANVASCII_COLLAB_API_ORIGIN`
- `CANVASCII_COLLAB_TRUSTED_ORIGINS`
- `CANVASCII_COLLAB_ALLOW_DEV_AUTH_BYPASS=false`

Recommended values:

- `CANVASCII_COLLAB_API_ORIGIN=https://canvascii.com`
- `CANVASCII_COLLAB_TRUSTED_ORIGINS=https://canvascii.com,https://www.canvascii.com`

S3 snapshot storage is optional in production. The collab service still persists canonical state in Postgres.

## Database migration

Run the Better Auth migration against the production database before the first public launch:

```bash
DATABASE_URL=... \
BETTER_AUTH_URL=https://canvascii.com \
BETTER_AUTH_SECRET=... \
BETTER_AUTH_TRUSTED_ORIGINS=https://canvascii.com,https://www.canvascii.com \
pnpm --filter @canvascii/app auth:migrate
```

## DNS

- `canvascii.com` should point at Vercel
- `www.canvascii.com` should point at Vercel
- the collab service can use either:
  - its DigitalOcean default hostname, or
  - a dedicated custom hostname such as `collab.canvascii.com`

If you move the collab service to a custom hostname later, update `NEXT_PUBLIC_CANVASCII_COLLAB_URL` on Vercel to match.
