---
name: canvascii-agent
description: Use this when reading or editing Canvascii canvases without the browser UI, especially from a Canvascii share URL or when driving the Canvascii MCP server. Prefer the MCP tools first; fall back to the direct Canvascii HTTP APIs only when MCP is unavailable.
---

# Canvascii Agent

Canvascii exposes two non-UI surfaces:

1. The preferred path: the local MCP server in `packages/canvascii-mcp`
2. The fallback path: direct HTTP calls to the app API under `/api/v1/canvascii`

Use this skill whenever the task is “inspect/edit/share a canvas without the UI”.

If you need a compact tool inventory, read [references/mcp-tools.md](references/mcp-tools.md).

## Preferred workflow

1. If the MCP server is available, use it.
2. Start by configuring the target from a full share URL or from `canvasId + shareToken`.
3. Prefer the live room path when you want cursor presence or live typing:
   - `connect_live_canvas`
   - `get_live_canvas_snapshot`
   - `get_live_canvas_region_snapshot`
   - `get_canvas_rendered_text`
   - `search_live_canvas_text`
   - `list_live_collaborators`
   - `list_live_objects`
4. Read both the object summary and the rendered text view before proposing or applying edits.
   - For section-sized mockups, also read the region `specs` JSON from `get_live_canvas_region_snapshot`.
5. Check access first:
   - If `canEditSomewhere` is `false`, stop and report that the link is view-only.
   - If edits are portal-scoped, stay within the editable portal.
6. Treat ids as live-session data, not durable references:
   - if you plan to delete, move, or relabel by id, use ids from the latest `list_live_objects` result only
   - if you spent time reasoning or another collaborator may have edited, re-read before mutating
   - do not carry object ids forward from an older snapshot or another agent transcript
7. For the common surgical verbs, prefer the shared command runner first:
   - `get_canvas_command_help`
   - `preview_canvas_command_live`
   - `run_canvas_command_live`
8. For page, group, and component structure changes, use the shared structure runner:
   - `get_canvas_structure_command_help`
   - `preview_canvas_structure_command`
   - `run_canvas_structure_command`
9. Drop to the lower-level room-native tools when you need a primitive the command runners do not cover:
   - `apply_canvas_json_live`
   - `upsert_objects_live`
   - `create_text_live`
   - `stream_text_live`
   - `create_wireframe_rectangle_live`
   - `create_rectangle_live`
   - `enclose_text_live`
   - `set_text_alignment_live`
   - `set_rectangle_label_live`
   - `stream_rectangle_label_live`
   - `find_live_objects`
   - `delete_objects_by_query_live`
   - `clear_region_live`
   - `replace_region_live`
   - `create_line_live`
   - `create_path_live`
   - `move_object_live`
   - `move_objects_live`
   - `set_live_presence`
10. Use the non-live tools when the task is batch-like or websocket collaboration is unavailable:
   - `create_text`
   - `update_text`
   - `stream_text`
   - `create_rectangle`
   - `create_line`
   - `add_portal`
   - `update_portal`
   - `delete_portal`
11. Use `apply_canvas_action` only when the built-in tools do not cover the operation.
12. After edits, call `get_canvas_overview` and `get_canvas_rendered_text` again and summarize what changed.

## Shared verbs

Humans and agents should think in the same surgical verbs:

- `box.create`
- `text.create`
- `line.create`
- `object.move`
- `object.resize`
- `object.delete`
- `text.set`
- `box.title`
- `text.align`
- `text.enclose`
- `component.mark`
- `component.create`
- `component.attr`
- `component.use`
- `canvas.read`
- `canvas.apply`
- `canvas.resize`
- `canvas.expand`
- `canvas.shrink`
- `objects.move`
- `objects.find`
- `object.update`
- `objects.replace`
- `stack.pack`
- `objects.align`

The human UI exposes these through `cmd+k` in the bottom Agent Tools Terminal.
The MCP now exposes the same live object-edit verbs through:

- `get_canvas_command_help`
- `preview_canvas_command_live`
- `run_canvas_command_live`
- `get_canvas_structure_command_help`
- `preview_canvas_structure_command`
- `run_canvas_structure_command`

Prefer the canonical keyed syntax when describing intent to other agents or humans:

- `box.create top=5 left=100 width=50 height=20 title="Header" body="Body"`
- `text.create row=12 col=48 text="Status: ready"`
- `line.create fromRow=10 fromCol=20 toRow=10 toCol=42`
- `object.move target=selected top=20 left=80`
- `object.resize target=selected top=20 left=80 width=24 height=8`
- `box.title target=selected title="Header"`
- `box.body target=selected body="Save"`
- `component.use source="Button" top=12 left=40 label="Save"`
- `component.create name="Button" objects="id-1,id-2" attr.label="Save" attr.variant="primary"`
- `canvas.read top=0 left=0 width=80 height=20`
- `canvas.apply mode=upsert json="[{\"type\":\"rectangle\",\"top\":5,\"left\":10,\"width\":20,\"height\":8,\"label\":\"Header\"}]"`
- `canvas.resize rows=120 cols=320`
- `canvas.expand rows=40 cols=125`
- `canvas.shrink`
- `objects.move ids="id-1,id-2" deltaRow=4 deltaCol=10`
- `objects.find type=rectangle text="Overview" withinTop=0 withinLeft=0 withinWidth=80 withinHeight=20`
- `object.update target=selected top=20 left=80 width=24 height=8 body="Save" align=center`
- `objects.replace ids="id-1,id-2" json="[{\"type\":\"rectangle\",\"top\":20,\"left\":80,\"width\":24,\"height\":8}]"`
- `stack.pack ids="id-1,id-2,id-3" axis=vertical gap=shared align=start`
- `objects.align ids="id-1,id-2" edge=left`

The terminal and MCP still accept older positional aliases, but they normalize them to this keyed form before execution.

Current scope:

- `run_canvas_command_live` covers the live box/text/line/object/canvas command subset above
- `run_canvas_structure_command` covers page/component/group structure changes

## Replace-region rule

When the user asks to "clean up", "replace", "redraw", or "turn this into boxes", do not layer a second structure on top of the first one.

Use this order:

1. Read the latest rendered snapshot.
2. Read `find_live_objects` or `list_live_objects`.
3. Prefer `replace_region_live` for atomic clear + redraw.
4. For a fast mockup patch that does not need a clear, prefer `upsert_objects_live`.
5. If you want one higher-level bulk entrypoint, use `apply_canvas_json_live` with:
   - `mode=upsert` for merge/update
   - `mode=replace-region` for clear + redraw
6. If you need a separate clear, use `clear_region_live`.
7. Draw the new structure once.
8. Re-read the rendered snapshot and confirm the region is clean.

If you cannot confidently identify the current live objects for a region, stop and say so instead of guessing.

## Revision safety

- Pass `expectedRevision` on live mutations when you are acting from a prior read.
- If the server reports a revision mismatch, re-read and re-plan.
- Do not force writes across revision changes.

## Boxed content rule

When content belongs inside a box, keep it inside the rectangle object itself.

- For a new labeled mockup box, use `create_wireframe_rectangle_live` with `label` for the border title and `body` or `bodyLines` for the box body.
- Use `create_rectangle_live` only when you need explicit non-wireframe rectangle styling.
- For an existing box title, use `set_rectangle_label_live` or `stream_rectangle_label_live`.
- For an existing box body, use `set_text_live`.
- To convert existing free text into a box, use `enclose_text_live`.
- `labelLines` is only a legacy internal field name. Agents should think and write in terms of box `label` plus box `body` / `bodyLines`.
- Avoid creating a separate text object on top of a rectangle unless the user explicitly wants free-floating text.

This keeps the canvas structurally correct, preserves resize/move behavior, and matches how humans expect boxes to work.

## MCP launch

From `/Users/ameer/projects/canvascii`:

```bash
CANVASCII_SHARE_URL="http://localhost:5001/?canvas=...&share=..." /Users/ameer/projects/canvascii/scripts/canvascii-mcp-stdio
```

Equivalent direct entrypoint:

```bash
CANVASCII_SHARE_URL="http://localhost:5001/?canvas=...&share=..." node /Users/ameer/projects/canvascii/packages/canvascii-mcp/server.mjs
```

Important:

- Do not register Canvascii MCP through `pnpm mcp:start` in a stdio MCP client.
- `pnpm` prints banner text to stdout before the MCP protocol starts, which breaks the handshake.
- If a session started before `canvascii` MCP was registered, use a fresh session or subprocess. Some clients do not hot-load new MCP manifests.
- If a documented Canvascii MCP tool is missing from your client, assume stale tool discovery first and restart the session before concluding the server does not expose that tool.

Optional environment variables:

- `CANVASCII_BASE_URL`
- `CANVASCII_CANVAS_ID`
- `CANVASCII_SHARE_TOKEN`
- `CANVASCII_SESSION_COOKIE`

Use `CANVASCII_SESSION_COOKIE` only when owner-only operations are required, such as changing sharing or managing portals on an owner-only link.

## Mental model

- `get_canvas_overview` tells you what objects exist.
- `get_live_canvas_snapshot` is the best first read for agents because it combines rendered text, object summaries, and collaborator presence from the websocket room.
- `get_live_canvas_region_snapshot` is the best read when an agent wants to redraw one section quickly because it returns:
  - rendered text
  - summarized objects
  - canonical JSON specs that round-trip into `apply_canvas_json_live`, `upsert_objects_live`, or `replace_region_live`
- `get_canvas_rendered_text` shows what the canvas currently looks like in plain text.
- `search_live_canvas_text` helps agents find labels like `@ameer` or `@codex` without the browser.
- `get_canvas_rendered_text` accepts `startRow`, `startCol`, `maxRows`, and `maxCols`, so use it like a viewport when the canvas is large.
- `list_live_collaborators` shows every human and agent in the room, including cursor, tool, and status.
- `list_live_objects` gives you stable object ids for follow-up edits.
- `move_objects_live` lets agents reposition a cluster of objects together in one room command batch.
- `list_live_objects` is only stable for the current live board state. It is not a durable id ledger across delayed or multi-agent edits.
- Rectangle objects support both a border title and body text. Treat them as editable boxes, not as backgrounds for overlaid text.
- `connect_live_canvas` plus the `*_live` tools make the agent appear like a collaborator with a cursor and live updates.
- `get_canvas_agent_capabilities` is the quick sanity check for what a fresh client should expect to see.

## Direct HTTP fallback

If MCP is unavailable, read [references/http-api.md](references/http-api.md).

The key rule:

- Shared-link reads and writes go through `/api/v1/canvascii/canvas`
- High-level agent edits go through `/api/v1/canvascii/agent`
- Owner-only share-policy mutations still require an authenticated owner session

## Interaction style

- Do not ask the user to click around in the browser if the API or MCP can do the work directly.
- Prefer small, reversible edits.
- When a share link is view-only, say so with the concrete access flags instead of guessing.
- When editing via a share link, keep changes inside the granted region unless the access summary says the link can edit anywhere.
