# Canvascii

Canvascii is now a standalone workspace.

## Structure

- `apps/canvascii`: Next.js app, Better Auth routes, local canvas library API
- `apps/canvascii-collab`: Hocuspocus realtime sync and snapshot service
- `packages/canvascii-core`: shared document, command, event, and runtime contracts

## Local stack

```bash
pnpm install
pnpm build
pnpm stack:up
pnpm stack:test
```

Use `.env.example` if you want to override the local defaults outside Docker.

The Docker stack starts:

- `canvascii-app` on `http://127.0.0.1:5001`
- `canvascii-collab` on `ws://127.0.0.1:5002`
- `canvascii-postgres` on `127.0.0.1:5004`
- `canvascii-minio` on `127.0.0.1:5005`

The app now owns its own auth and file library routes. You can create an account at `/sign-in`, then save canvases without relying on any external monorepo API.

## Production

Production uses:

- Vercel for `apps/canvascii`
- DigitalOcean App Platform for `apps/canvascii-collab`
- a shared Postgres database

Deployment notes live in [docs/production-deploy.md](/Users/ameer/projects/canvascii/docs/production-deploy.md).
