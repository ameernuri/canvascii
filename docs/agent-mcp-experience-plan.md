# Agent MCP Experience Plan

## Goal

Make Canvascii feel natural for a first-time agent:

- join a shared canvas successfully
- appear in the room with a clear identity
- see other collaborators reliably
- read the canvas in a way that matches what humans see
- make safe edits without learning internal transport details
- collaborate with multiple agents without accidental stomps or stale ghosts

The design target is not "agents can eventually figure it out." The target is "agents use it naturally on first contact."

## Principles

- One shared command language across MCP, agent client, and human terminal.
- Live room is the default path, not an optional advanced path.
- Identity and presence must be trustworthy.
- Safe semantic edits should be easier than unsafe geometric edits.
- Error messages should tell the agent what to do next without requiring platform knowledge.

## Problems To Fix

### P0. Live onboarding reliability

- `configure_canvascii_target` can succeed while `connect_live_canvas` still fails with `Room document is missing`.
- MCP clients can expose stale command manifests and silently miss new verbs.
- Agents cannot easily distinguish "connected to target" from "live room is actually usable".

### P0. Identity and presence trust

- Default agent identity is too generic.
- MCP wrapper currently risks collapsing sessions under one actor identity.
- Presence can linger after disconnect and create collaborator ghosts.

### P0. First-edit safety

- Concurrent semantic edits are effectively last-write-wins unless the caller already knows to opt into revision discipline.
- First-time agents do not get conflict-aware guidance by default.

### P1. Shared-surface coherence

- Help, parser, preview, execution, and docs must move together.
- The human terminal should not carry a shadow grammar for live verbs.

### P1. Semantic scene editing

- Agents need object-level semantic edits more than region wipes.
- The platform should bias toward:
  - query
  - patch
  - replace exact ids
  - pack
  - align

### P2. Higher-level composition

- Once the low-level semantic layer is solid, add layout/container primitives.
- Avoid introducing rigid one-off UI types before the semantic base is stable.

## Execution Order

### 1. Fix live onboarding reliability

Status: in progress

- Wait for the room document after websocket sync instead of assuming sync implies usable state.
- Surface a stronger "live ready" contract in the agent client and MCP wrapper.
- Improve live connection error messages to distinguish:
  - target not configured
  - access denied
  - room unresolved
  - room connected but document missing

### 2. Fix identity and presence

Status: in progress

- Accept friendly alias inputs like `agentName` and `agentColor` in the agent client.
- Stop using a constant default `actorId` in the MCP wrapper.
- Clear awareness state on disconnect.
- Include `updatedAt` in published presence so stale session handling can evolve cleanly.

### 3. Improve first-edit safety

Status: in progress

- Add a safe semantic mutation mode that reads current revision and fails with a conflict payload when stale.
- Return actionable conflict responses with fresh context hints.

### 4. Keep the shared command layer coherent

Status: in progress

- Reuse the shared live command grammar from the human terminal.
- Add parity tests so new verbs cannot drift again.

### 5. Expand semantic collaboration operations

Status: in progress

- Keep building on:
  - `objects.find`
  - `object.update`
  - `objects.replace`
  - `stack.pack`
  - `objects.align`

### 6. Add a first-contact collaboration smoke test

- One canvas
- multiple fresh agents
- visible presence
- semantic edit handoff
- conflict case
- cleanup

## Progress

- Done: room-document wait after websocket sync in the live client
- Done: friendlier constructor aliases for agent identity (`agentName`, `agentColor`)
- Done: MCP wrapper no longer forces one default actor id for every session
- Done: disconnect clears awareness state before teardown
- Done: published presence now carries `updatedAt`
- Done: agent route now returns actionable stale-write/conflict responses instead of generic 500s
- Done: added a real first-contact collaboration smoke script for live join, presence, semantic edit handoff, guarded conflict, and cleanup
- Done: live client now promotes `canvasId` to the active live canvas after connect instead of leaving it as the requested file id
- Done: stale agent collaborators are filtered from both the agent client and the app UI using presence `updatedAt`
- Done: added shared `canvas.status` so humans and agents can ask the same live-room readiness question
- Next: promote the smoke flow into a documented operator/developer workflow and extend it to cover MCP-specific live join behavior directly

## Success Criteria

- A fresh agent can connect live on the first try from a share URL.
- The agent sees itself and others with stable identities.
- Disconnect does not leave collaborator ghosts behind.
- Shared command help, parser, preview, and execution all agree.
- First-time agents can query and patch objects without learning canvas/document/room internals.
- Concurrent edits fail safely or explain the conflict clearly instead of silently stomping.
