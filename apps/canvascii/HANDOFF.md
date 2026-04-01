# Canvascii Handoff

## Canonical Repo

- active repo: `/Users/ameer/projects/canvascii`
- app: `/Users/ameer/projects/canvascii/apps/canvascii`
- collab service: `/Users/ameer/projects/canvascii/apps/canvascii-collab`
- shared contracts: `/Users/ameer/projects/canvascii/packages/canvascii-core`

Do not resume work from these old locations:

- monorepo copy: `/Users/ameer/bizing/code/apps/canvascii`
- old standalone copy: `/Users/ameer/bizing/canvascii.removed-2026-03-08`

The old standalone repo was severed from active use. The monorepo copy still exists, but it is no longer the product source of truth.

## Repo State

- `/Users/ameer/projects/canvascii` is its own git repo on `main`
- there is one disabled nested git directory left from the copy:
  - `/Users/ameer/projects/canvascii/apps/canvascii/.git.disabled`
- all Canvascii Docker containers and local dev processes were stopped at the end of the last session
- no Canvascii ports should currently be listening:
  - `5001`
  - `5002`
  - `5003`
  - `5004`
  - `5005`
  - `5006`

## Product/Architecture Summary

Canvascii is a standalone collaborative canvas tool with:

- local Better Auth
- saved canvas file CRUD inside the app
- `Yjs + Hocuspocus` realtime collaboration
- local-first persistence plus snapshot backup
- a canonical `CanvasDocument` model
- command/event contracts in `@canvascii/core`
- portal-based sharing and mixed `view` / `edit` access
- an agent-edit HTTP surface at `/api/v1/canvascii/agent`

Primary architecture doc:

- `/Users/ameer/projects/canvascii/apps/canvascii/ARCHITECTURE.md`

## What Is Already Working

- standalone repo shape is in place
- Better Auth lives inside the app
- saved canvas file CRUD lives inside the app
- collab service exists and uses session validation through the app
- canonical document contracts exist in `@canvascii/core`
- Yjs rooms store canonical document state plus a temporary legacy shadow
- command diff/executor exists and is used in file persistence and Yjs writes
- editor commit boundaries now emit typed command/event batches
- pointer-driven commit edges are partially command-first
- pan tool exists and `Space` activates it
- text-drag creates borderless rectangle-text containers
- canvas auto-extends during drag/create/resize flows
- lines and paths can bind to rectangle/text borders
- lines and paths support inline labels
- multi-segment paths can close into loops
- portals are first-class overlays with draw/edit/share flows
- sharing supports:
  - whole-canvas grants
  - portal grants
  - invite by email
  - multiple access links
  - mixed portal `view` / `edit`
  - optional whole-canvas context view for portal shares
- agent-edit surface exists
- local shadcn UI layer is installed in the standalone app
- Tailwind 4 is installed in the standalone app

## Important Current Reality

The standalone app is mid-migration from the older UI layer to the newer shadcn/Base UI component set.

That means:

- many shadcn components are now present under:
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/ui`
- some existing app code still assumes older Radix-style APIs such as `asChild`
- several of those mismatches were already fixed in the last session
- more type/runtime mismatches may still surface as build errors until the migration is finished

## Current Blocker

The last session ended with the standalone app build failing on the new `ToggleGroup` API.

Current failing file:

- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/toolbar/ToolbarStyleMode.tsx:19`

Current error:

- `Type 'StyleMode' is not assignable to type 'readonly string[] | undefined'`

Interpretation:

- the local shadcn/Base UI `ToggleGroup` API in this repo no longer matches the old single-string value shape used by that toolbar
- this is part of the broader UI migration, not a product-logic regression

## Recent UI Migration Work Already Done

These were already fixed and should not be re-diagnosed from scratch:

- `PopoverTrigger asChild` mismatch fixed in:
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/canvas/RectangleTextFloatingControls.tsx`
- `DialogDescription asChild` mismatch fixed in:
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/dialogs/InfoDialog.tsx`
- several trigger wrappers were rewritten to stop using `asChild` in:
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/footer/FooterInfo.tsx`
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/toolbar/ToolbarDiagrams.tsx`
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/canvas-share-dialog.tsx`
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/canvascii-page.tsx`
- share dialog access controls were turned into real joined button groups in:
  - `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/canvas-share-dialog.tsx`

## Most Useful Files For The Next Session

Start here:

- `/Users/ameer/projects/canvascii/apps/canvascii/HANDOFF.md`
- `/Users/ameer/projects/canvascii/apps/canvascii/ARCHITECTURE.md`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/canvas-share-dialog.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/canvascii-page.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/asciip-core/components/toolbar/ToolbarStyleMode.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/ui/toggle-group.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/ui/popover.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/ui/dialog.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/ui/tooltip.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/app/globals.css`
- `/Users/ameer/projects/canvascii/apps/canvascii/package.json`
- `/Users/ameer/projects/canvascii/apps/canvascii/postcss.config.js`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/app/layout.tsx`

Model/collab/storage files:

- `/Users/ameer/projects/canvascii/apps/canvascii/src/lib/server/auth.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/lib/server/canvas-library-store.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/app/api/v1/canvascii/share/route.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/app/api/v1/canvascii/collab-access/route.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/app/api/v1/canvascii/agent/route.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/lib/canvascii/document-bridge.ts`
- `/Users/ameer/projects/canvascii/apps/canvascii/src/components/canvascii/collaborative-editor-shell.tsx`
- `/Users/ameer/projects/canvascii/apps/canvascii-collab/src/server.ts`
- `/Users/ameer/projects/canvascii/packages/canvascii-core/src/sharing.ts`

## First Commands For A New Session

From `/Users/ameer/projects/canvascii`:

```bash
pnpm install
pnpm --filter @canvascii/app build
```

If the build is green again:

```bash
pnpm build
pnpm stack:up
```

To stop everything:

```bash
pnpm stack:down
```

## Recommended Next Steps

In order:

1. Fix the `ToggleGroup` API mismatch in `ToolbarStyleMode.tsx`.
2. Re-run `pnpm --filter @canvascii/app build`.
3. Keep sweeping the remaining shadcn/Base UI migration mismatches until the standalone app is fully green.
4. Once the UI layer is stable again, continue the product work in the standalone repo only.

## After The UI Build Is Stable

The next meaningful product/architecture work is:

- continue replacing reducer-first editor mutation ownership with command-first flows
- keep moving interaction paths toward canonical command dispatch
- move share policy storage out of the file record into relational metadata
- expose a more formal MCP/tool wrapper over the existing agent-edit HTTP surface

## Summary For A Fresh Codex Session

If a new session needs one paragraph:

Canvascii now lives only at `/Users/ameer/projects/canvascii`. Ignore the monorepo copy and the removed old standalone copy under `~/bizing`. All Canvascii processes are stopped. The product architecture is already in place around Better Auth, saved file CRUD, `Yjs + Hocuspocus`, portals, mixed access, and a canonical command/document model. The immediate task is not product design; it is finishing the standalone shadcn/Base UI migration so the app builds cleanly again, starting with `ToolbarStyleMode.tsx` and any remaining old-API trigger/toggle mismatches.
