# Canvascii Architecture

## Goals

Canvascii should feel like one coherent system for:

- human editing
- agent editing
- live collaboration
- large-canvas rendering
- durable persistence

The design target is:

- one live mutation authority
- one canonical document model
- one presence model
- explicit contracts for reads, writes, and concurrency

## System shape

### App

`apps/canvascii`

Owns:

- auth
- file/library UX
- sharing/fences UX
- portal navigation UX
- collab session issuance
- human editor shell

### Collab

`apps/canvascii-collab`

Owns:

- websocket room lifecycle
- principal/access resolution
- live command application
- revision preconditions
- persistence scheduling
- room presence fanout

### Core

`packages/canvascii-core`

Owns:

- document contracts
- transport contracts
- rendering helpers
- access rules
- primitive command model

### Agent transports

`packages/canvascii-agent-client`
`packages/canvascii-mcp`

Own:

- websocket-native agent participation
- MCP adaptation
- safe query/mutation workflows

They should not become a second mutation authority.

## Canonical data model

The live canonical model is the canvas document in the collab room:

- canvases
- regions
- objects
- metadata
- version

Persistence snapshots should mirror that model directly.

## Mutation model

All live edits should flow through room commands.

Current practical shape:

- stateless command request over websocket
- room-side authorization
- room-side apply
- persisted room document

Long-term shape:

- finer-grained command taxonomy beyond coarse `object.upsert`
- explicit create/move/resize/text/portal commands

## Concurrency

Every live mutation should support revision preconditions.

Rules:

- reads return current `revision`
- writes can include `expectedRevision`
- collab rejects stale writes
- agents re-read and retry instead of forcing stale mutations

This keeps the safety model in the server contract, not just in agent behavior docs.

## Query model

The system should support both:

- object-id mutation for fresh local edits
- query/region mutation for structural edits

Preferred structural primitives:

- `find_live_objects`
- `delete_objects_by_query_live`
- `clear_region_live`
- `replace_region_live`

This avoids stale-id workflows and makes agent edits composable.

## Human and agent parity

Humans and agents should share:

- same room
- same presence semantics
- same object primitives
- same edit authorization
- same persistence path

Agents should not rely on browser automation for normal work.

## Fence vs portal

### Fence

- access boundary
- lives in share policy
- no content projection
- subtle visual treatment

### Portal

- navigable live window
- lives in document/editor state
- can target same canvas or another document
- eventually should support remote live subscription cleanly through the collab layer

## Performance principles

### Reads

- do not read heavyweight file/editor blobs for share-only mutations
- keep share metadata and document state on separate fast paths

### Writes

- avoid whole-document rewrite patterns where object-level commands are enough
- use optimistic UI for interaction feel
- keep server work proportional to the mutation, not the total document size

### Rendering

- prefer viewport-oriented reads for agents
- preserve rendered-text views for planning and verification
- keep object summaries cheap and queryable

## Persistence

Primary persistence is DB-backed:

- file/library records in Postgres
- collab snapshots in Postgres

Filesystem persistence is legacy/import compatibility only.

Long term, persistence should evolve toward:

- periodic snapshots
- append-only accepted command log

That gives replay, auditability, and safer recovery.

## Extension rules

When adding a new primitive:

1. add it to core contracts
2. authorize it in collab
3. expose it in agent client
4. expose it in MCP if useful
5. document the safe workflow

Do not add a browser-only primitive first and retrofit agents later.

## Current migration direction

The active rearchitecture path is:

1. room-native agent writes
2. revision-safe mutations
3. query/region structural edits
4. deterministic style controls for agent-created objects
5. portal/fence separation

That is the right backbone for making Canvascii scalable, extensible, elegant, and fast without splitting humans and agents into different systems.
