# Canvascii App

This app hosts three things:

- the standalone Canvascii UI
- Better Auth route handlers
- the local canvas library API under `/api/v1/canvascii/*`

## Development

```bash
pnpm --filter @canvascii/app dev
pnpm --filter @canvascii/app auth:migrate
```

Key environment defaults live in `src/lib/server/env.ts`.

Storage boundaries:

- auth tables: Postgres
- persistent canvases: Postgres
- local offline/live cache: IndexedDB
- live collaborative document sync: Yjs + Hocuspocus
- filesystem: export/import only
