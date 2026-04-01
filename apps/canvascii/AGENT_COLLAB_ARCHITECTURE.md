# Agent-First Collaboration Architecture

## Why this exists

Canvascii already has the right realtime substrate:

- `Yjs`
- `Hocuspocus`
- awareness-based presence
- portal-aware access control
- a command/runtime layer in `@canvascii/core`

But agents are still second-class because they mostly edit through side-channel HTTP routes. That is useful, but it is not native collaboration.

## Product goal

Humans and agents should share the same live model:

- same websocket room
- same actor/session identity model
- same cursor and presence semantics
- same command runtime
- same shape primitives
- same authorization rules
- same persistence path

The difference between a human and an agent should be metadata and UX, not a separate mutation stack.

## Current architectural problem

Today there are two edit authorities:

1. the collab room
2. side-channel HTTP mutation routes

That split causes the wrong behavior:

- agents do not naturally appear as collaborators
- live typing is simulated instead of room-native
- cursor/activity state is disconnected from the mutation path
- object updates tend to become snapshot rewrites
- persistence authority is ambiguous

## Target architecture

### 1. Actor sessions are first-class

Every collaborator is an actor session:

- `actorType`: `human | agent | system`
- `actorId`: stable logical identity
- `sessionId`: ephemeral connection identity
- `principal`: auth/access subject
- `capabilities`: edit, stream-text, manage-portals, etc.

Humans and agents both join rooms as actor sessions.

### 2. The websocket room is the live mutation authority

HTTP remains for:

- file/library CRUD
- share management
- collab-session issuance
- import/export/recovery

But live editing should primarily happen through the room.

### 3. Commands are the universal mutation envelope

All live edits should become command batches, regardless of actor origin.

Examples:

- `object.create`
- `object.update`
- `object.delete`
- `object.move`
- `text.set`
- `text.insert`
- `rectangle.resize`
- `portal.create`
- `portal.update`

The current `object.upsert` model is a workable bridge, but it is too coarse as the long-term API for agent-safe editing.

### 4. Presence stays in-room and becomes richer

Presence should remain ephemeral awareness data, but include:

- actor/session identity
- cursor
- active tool
- operation status: `idle`, `thinking`, `editing`, `streaming`
- operation summary
- draft geometry / selection intent

That lets humans see what an agent is doing before and during the mutation.

### 5. Normalized room state replaces whole-document rewrites

The current room stores a large canonical document blob and a legacy shadow blob. That is acceptable as a bridge, but not as the final design.

The target room model should be normalized:

- `meta`
- `canvases`
- `regions`
- `objects`
- `ordering`
- `activity`

Incremental object updates should not require rewriting the entire document.

## Recommended topology

### `@canvascii/core`

Own:

- document types
- command types
- event types
- actor/presence contracts
- authorization helpers
- primitive mutation helpers

### `apps/canvascii-collab`

Own:

- websocket auth
- room lifecycle
- command application
- presence fanout
- event fanout
- snapshotting
- event log tailing

### `apps/canvascii`

Own:

- file library
- auth UX
- share management UX
- collab-session issuance
- human editor shell
- owner/admin views for agents

### `packages/canvascii-mcp`

This should become a transport adapter, not a direct-edit backdoor:

1. request a collab session
2. join the websocket room
3. publish agent presence
4. submit command batches
5. observe live updates

## Agent session design

Introduce a dedicated collab-session token for humans and agents.

The claim should include:

- `documentId`
- `actorId`
- `actorType`
- `sessionId`
- `access`
- portal scopes
- `expiresAt`
- optional display metadata

The collab service should validate this directly and derive the room principal from it.

## Live editing model

### Human edits

- editor interactions produce command batches
- the room validates and applies them
- all peers observe the same update

### Agent edits

- agent joins as an actor session
- publishes presence with `thinking` / `streaming`
- submits the same command types as humans
- updates existing primitives without replacing unrelated structure

### Text streaming

Text streaming should be explicit:

- select or create a text object
- publish `streaming` presence
- emit incremental text-update commands against that object
- all peers render partial content live

That is the right abstraction for token-by-token LLM output.

## Authorization model

Authorization should happen at room-side command apply time, not only at save time.

Checks should answer:

- can this actor read here?
- can this actor edit this object?
- can this actor create in this portal?
- can this actor perform structural canvas changes?

Portal-scoped humans and portal-scoped agents should behave identically.

## Persistence model

The room should persist:

1. periodic snapshots of normalized state
2. an append-only event log of accepted commands

That supports:

- replay/debugging
- auditability
- agent action traces
- scalable recovery

## Migration plan

### Phase 1: actor foundation

- add actor/session fields to principals and presence
- stop keying collaborators only by `userId`
- add collab-session issuance

### Phase 2: agent websocket client

- add an agent client package
- connect through Hocuspocus/Yjs
- publish presence
- read/write room state through the same runtime

### Phase 3: room-side command gateway

- authorize and apply commands in the collab service
- emit activity/events from the room runtime

### Phase 4: primitive-safe command expansion

- move beyond coarse `object.upsert`
- add text/object-specific mutation commands

### Phase 5: persistence inversion

- make the room/event log authoritative
- keep file snapshots as downstream materializations
- retain HTTP edit routes only as compatibility/fallback

## Immediate implications

1. `/api/v1/canvascii/agent` is a compatibility surface, not the final architecture.
2. Agents should stop editing by rewriting file snapshots.
3. MCP should prefer websocket collab sessions over direct HTTP mutation.
4. The room should become the single live edit authority for humans and agents.
