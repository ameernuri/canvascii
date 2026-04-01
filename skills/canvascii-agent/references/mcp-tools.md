# Canvascii MCP Tools

## Clean stdio launch

Use one of these entrypoints in an MCP client:

```bash
/Users/ameer/projects/canvascii/scripts/canvascii-mcp-stdio
```

```bash
node /Users/ameer/projects/canvascii/packages/canvascii-mcp/server.mjs
```

Do not use `pnpm mcp:start` for stdio MCP registration. `pnpm` prints to stdout before the protocol handshake.
If a documented Canvascii MCP tool is missing from your client, restart the session or subprocess first. Some MCP clients do not hot-load newly registered tools.

## Session setup

- `get_canvas_agent_capabilities`
- `configure_canvascii_target`
- `connect_live_canvas`
- `get_canvas_access`

## Shared command language

- `get_canvas_command_help`
- `preview_canvas_command_live`
- `run_canvas_command_live`
- `get_canvas_structure_command_help`
- `preview_canvas_structure_command`
- `run_canvas_structure_command`

Use these first when the task maps cleanly to:

- `box.create`
- `box.title`
- `box.body`
- `text.create`
- `line.create`
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
- `object.move`
- `object.resize`
- `object.delete`
- `text.set`
- `text.align`
- `text.enclose`
- `page.new`
- `page.open`
- `page.list`
- `group.create`
- `group.break`
- `component.mark`
- `component.create`
- `component.attr`
- `component.use`
- `component.create name="Button" objects="id-1,id-2" attr.label="Save" attr.variant="primary"`

The command runner accepts the same canonical keyed syntax as the bottom human terminal and still normalizes older positional aliases.

## Read the canvas

- `get_live_canvas_snapshot`
- `get_live_canvas_region_snapshot`
- `get_canvas_rendered_text`
- `search_live_canvas_text`
- `list_live_objects`
- `find_live_objects`
- `list_live_collaborators`
- `get_collaborator_selection_live`

## Create objects

- `upsert_objects_live`
- `apply_canvas_json_live`
- `create_text_live`
- `create_wireframe_rectangle_live`
- `create_rectangle_live`
- `enclose_text_live`
- `create_line_live`
- `create_path_live`

## Edit existing objects

- `move_object_live`
- `move_objects_live`
- `set_text_alignment_live`
- `resize_object_live`
- `set_text_live`
- `set_rectangle_label_live`
- `stream_text_live`
- `stream_rectangle_label_live`
- `delete_objects_by_query_live`
- `clear_region_live`
- `replace_region_live`
- `delete_object_live`
- `delete_all_objects_live`

## Share and fences

- `add_portal`
- `update_portal`
- `delete_portal`

## Guidance

- Prefer `run_canvas_command_live` for the common box/text/line/object/canvas verbs.
- Prefer `run_canvas_structure_command` for page/component/group changes.
- Prefer `get_live_canvas_region_snapshot` when you want both the rendered slice and the JSON/spec slice for the same area.
- Prefer `apply_canvas_json_live` when you want one bulk entrypoint for either:
  - `mode=upsert`
  - `mode=replace-region`
- Prefer `upsert_objects_live` when you want to draw or patch a whole mockup section in one round-trip.
- Prefer `move_objects_live` when you want to reposition a cluster of objects together.
- Use `preview_canvas_command_live` before mutating when you want normalized syntax and a spatial preview.
- Use `preview_canvas_structure_command` before mutating when you want normalized syntax and a page/component/group preview.
- Use `get_canvas_command_help` when you want the supported canonical verbs and examples.
- Use `get_canvas_structure_command_help` when you want the supported page/component/group verbs and examples.
- Prefer `*_live` tools when you want first-class collaboration behavior.
- Prefer `create_wireframe_rectangle_live` for deterministic wireframe boxes.
- Prefer `set_rectangle_label_live` for rectangle border titles.
- Prefer `set_text_live` for rectangle body text.
- In rectangle create/upsert JSON, use `body` or `bodyLines` for box body text. `labelLines` is a legacy internal field name.
- Prefer `enclose_text_live` when turning free text into a box.
- Prefer `find_live_objects` over carrying old ids forward.
- Prefer `replace_region_live` for structural rewrites.
- The object specs returned by `get_live_canvas_region_snapshot` are designed to round-trip back into `upsert_objects_live` and `replace_region_live`.
- Use `expectedRevision` when mutating from a previously read snapshot.
- Use `get_canvas_rendered_text` before and after edits to confirm what changed.
- Use `list_live_objects` immediately before id-based mutations.
- Do not reuse object ids from an earlier snapshot, another agent transcript, or a delayed planning step.
- For structural rewrites, first delete the current live objects in the region, then redraw once.
