# Canvascii Agent Guide

Use Canvascii natively. Do not default to browser automation when the MCP or websocket agent surface can do the work.

## Preferred path

1. Start the Canvascii MCP server from `/Users/ameer/projects/canvascii`.
2. Configure the target from a full share URL when possible.
3. Connect to the live canvas before editing so you can see collaborators, cursors, viewports, and rendered text.
4. Read both:
   - the rendered text viewport
   - the live object list
   - the region JSON/spec snapshot when you are planning a bulk redraw
5. Prefer the shared live command layer first:
   - `get_canvas_command_help`
   - `preview_canvas_command_live`
   - `run_canvas_command_live`
6. For pages, groups, and components, use the shared structure command layer:
   - `get_canvas_structure_command_help`
   - `preview_canvas_structure_command`
   - `run_canvas_structure_command`
7. Drop to the lower-level live MCP tools only when a shared command layer does not cover the primitive.
8. In the human UI, `cmd+k` opens the bottom Agent Tools Terminal for the same kind of surgical commands.

## Core rules

- Prefer websocket-native tools over HTTP fallback tools.
- Prefer bulk region reads and bulk JSON upserts when the task is a whole mockup or a section rewrite.
- Rectangle border titles and rectangle body text are separate concepts.
- Prefer editing a rectangle border title with `set_rectangle_label_live`.
- Prefer editing rectangle body text with `set_text_live`.
- In agent-facing JSON and MCP inputs, use `body` or `bodyLines` for box body text.
- Treat `labelLines` as a legacy internal field name, not the public rectangle-body vocabulary.
- Use `create_wireframe_rectangle_live` for deterministic mockup boxes.
- Use `create_rectangle_live` only when you intentionally want custom rectangle styling.
- Use `enclose_text_live` to turn an existing text object into a box instead of recreating it manually.
- Use `set_text_alignment_live` for free text and rectangle body alignment.
- Use `set_rectangle_label_live` or `stream_rectangle_label_live` for existing boxes.
- Use `set_text_live` only when you intentionally want generic text-capable object editing.
- Use fences for share/access boundaries.
- Use portals for navigable windows into another canvas or another region.
- Use pages as nested canvases inside one file.
- Use component pages for reusable definitions and component instances when you want source edits to flow through every usage.

## Typical workflow

1. `configure_canvascii_target`
2. `connect_live_canvas`
3. `get_live_canvas_snapshot`
4. `search_live_canvas_text`
5. `get_live_canvas_region_snapshot`
6. `list_live_objects`
7. Prefer `run_canvas_command_live` for box/text/line/object/canvas verbs
8. For section-sized mockups, prefer:
   - `get_live_canvas_region_snapshot`
   - `apply_canvas_json_live`
   - `upsert_objects_live`
   - `move_objects_live`
   - `replace_region_live`
9. Apply lower-level edits with the `*_live` tools when needed
10. Re-read `get_live_canvas_snapshot` or `get_canvas_rendered_text`

## Safe mutation rules

- Treat object ids as valid only for the current live read.
- Re-read before id-based move, resize, delete, or text mutation.
- Prefer `expectedRevision` on live mutations whenever you are acting from a prior read.
- Prefer `get_live_canvas_region_snapshot` before large edits so the JSON/spec view and rendered view come from the same revision.
- For structural changes, prefer:
  - `upsert_objects_live`
  - `move_objects_live`
  - `clear_region_live`
  - `replace_region_live`
  - `delete_objects_by_query_live`
- Do not rewrite structure by overlaying new objects on top of stale ones unless the user explicitly wants an overlay.

## Safe live-edit discipline

Treat the canvas as volatile live state.

- Never delete or move objects from a stale snapshot.
- Read `get_live_canvas_snapshot` and `list_live_objects`, then mutate immediately from that exact read.
- When drawing a whole mockup section, read `get_live_canvas_region_snapshot` once and apply one `upsert_objects_live` or `replace_region_live` call instead of many single-object calls.
- If you pause to reason, ask another tool, or perform multiple-step edits, re-read the live object list before deleting by id.
- If the task is "replace this region", first identify the live objects that currently occupy that region, then delete those exact live ids, then redraw once.
- Do not stack replacement rectangles on top of older regions unless the user explicitly asked for an overlay.
- After edits, always re-read the rendered snapshot and confirm the structure matches the intent, not just that objects exist.

## MCP registration

Use a stdio-clean entrypoint:

```bash
/Users/ameer/projects/canvascii/scripts/canvascii-mcp-stdio
```

or:

```bash
node /Users/ameer/projects/canvascii/packages/canvascii-mcp/server.mjs
```

Do not register the MCP server through `pnpm mcp:start`. `pnpm` writes banner text to stdout before the MCP handshake and breaks stdio transport.

If your agent session started before the `canvascii` MCP server was registered, start a fresh session or subprocess. Some clients do not hot-load newly added MCP servers into an already-running session.
If a documented Canvascii MCP tool is missing from your client, assume stale MCP tool discovery first and restart the session before concluding the server does not expose that tool.

## When you need browser automation

Use Playwright only for testing the human UI itself. Do not use it as the default way to inspect or mutate canvas content.

## Important primitives

- Text object: free text on the canvas
- Rectangle title: text on the top border of a box
- Rectangle body: text inside a box
- Line/polyline label: text attached to a connector
- Page: a nested canvas inside the current file
- Component page: a reusable page definition
- Component instance: a live usage of a component page
- Fence: access boundary
- Portal: navigable live window

## Shared command language

Canvascii now exposes a small terminal-style verb set for humans and agents.
Prefer the canonical keyed syntax:

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
- `page.new`
- `page.open`
- `page.list`
- `component.mark`
- `component.create`
- `component.attr`
- `component.use`
- `canvas.read`
- `canvas.status`
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
- `group.create`
- `group.break`

Examples:

- `box.create top=5 left=100 width=50 height=20 title="Header" body="Body"`
- `text.create row=12 col=48 text="Status: ready"`
- `object.move target=selected top=20 left=80`
- `component.use source="Button" top=12 left=40 label="Save"`
- `component.create name="Button" objects="id-1,id-2" attr.label="Save" attr.variant="primary"`
- `canvas.read top=0 left=0 width=80 height=20`
- `canvas.status`
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

In the UI, these are available from `cmd+k` in the bottom Agent Tools Terminal.
The UI still accepts older positional aliases, but it normalizes them to the canonical keyed form before execution.
In MCP, prefer:

- `get_canvas_command_help`
- `preview_canvas_command_live`
- `run_canvas_command_live`
- `get_canvas_structure_command_help`
- `preview_canvas_structure_command`
- `run_canvas_structure_command`

These tools now expose the same command language for both:
- live object edits
- canvas structure changes like pages, groups, and components

## Fast mockup workflow

When the user wants a full section redrawn or a quick mockup:

1. `get_live_canvas_region_snapshot`
2. inspect:
   - `rendered.text`
   - `specs`
3. prepare one JSON array of object specs
4. send one:
   - `apply_canvas_json_live`
   - `upsert_objects_live`
   - or `replace_region_live`
5. verify with another `get_live_canvas_region_snapshot`

This is the preferred agent path for fast mockup generation because it avoids one-object-at-a-time round-trips.

## Good agent behavior

- Keep changes local and reversible.
- Publish presence when acting live.
- Stay within granted edit scope.
- If the link is view-only, report that explicitly instead of attempting writes.

## Capability check

If you want to verify what a fresh client should expect, call:

- `get_canvas_agent_capabilities`

This is also the right place to confirm the recommended fast mockup workflow:

- `get_live_canvas_region_snapshot`
- `apply_canvas_json_live`
- `upsert_objects_live`
- `move_objects_live`
