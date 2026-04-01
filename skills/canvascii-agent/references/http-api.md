# Canvascii HTTP API

Use this only if the Canvascii MCP server is unavailable.

## Base URL

Default local app:

```text
http://127.0.0.1:5001
```

## Share token transport

Either:

- query param: `?share=<token>`
- header: `x-canvascii-share-token: <token>`

## Read canvas

```http
GET /api/v1/canvascii/canvas?id=<canvasId>&share=<token>
```

Returns the full canvas detail including:

- `accessSummary`
- `editorState`
- `sharePolicy`
- `etag`

## Resolve access

```http
GET /api/v1/canvascii/collab-access?id=<canvasId>&share=<token>
```

Use this before edits. Stop if:

- `canEditSomewhere` is `false`

## Direct editor-state write

```http
PUT /api/v1/canvascii/canvas?share=<token>
Content-Type: application/json

{
  "id": "<canvasId>",
  "editorState": { ...full next editor state ... },
  "ifMatchEtag": "<etag>"
}
```

This accepts share-token principals if the link has edit access.

## High-level agent action

```http
POST /api/v1/canvascii/agent?share=<token>
Content-Type: application/json

{
  "id": "<canvasId>",
  "action": {
    "type": "create_text",
    "row": 20,
    "col": 40,
    "lines": ["hello"]
  }
}
```

Common actions:

- `upsert_objects`
- `move_objects`
- `replace_region`
- `set_canvas_size`
- `expand_canvas`
- `shrink_canvas_to_fit`
- `create_text`
- `create_rectangle`
- `create_line`
- `add_portal`
- `update_portal`
- `delete_portal`
- `share_canvas`
- `share_canvas_link`
- `share_portal`
- `share_portal_link`
- `update_grant`
- `revoke_grant`

Important:

- Share-policy actions still require an authenticated owner session.
- Shared-link edit actions should return `403` with a view-only message if the link cannot edit.
