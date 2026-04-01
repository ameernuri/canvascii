#!/usr/bin/env node

import { createRequire } from 'node:module'
import { createUniqueCanvasName, isGenericCanvasTitle } from '../packages/canvascii-agent-client/canvas-names.mjs'

const require = createRequire(new URL('../apps/canvascii/package.json', import.meta.url))
const { Pool } = require('pg')

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://user:password@127.0.0.1:5004/canvascii'

const pool = new Pool({ connectionString })

function renameGenericDiagrams(editorState, documentValue) {
  const diagrams = Array.isArray(editorState?.diagrams) ? editorState.diagrams : []
  if (diagrams.length === 0) {
    return { editorState, documentValue, renamedCount: 0 }
  }

  const taken = diagrams
    .map((diagram) => String(diagram?.name ?? '').trim())
    .filter((name) => name && !isGenericCanvasTitle(name))

  const renames = new Map()
  const nextDiagrams = diagrams.map((diagram) => {
    const currentName = String(diagram?.name ?? '').trim()
    if (!isGenericCanvasTitle(currentName)) {
      return diagram
    }
    const nextName = createUniqueCanvasName(taken)
    taken.push(nextName)
    renames.set(diagram.id, nextName)
    return {
      ...diagram,
      name: nextName,
    }
  })

  if (renames.size === 0) {
    return { editorState, documentValue, renamedCount: 0 }
  }

  const nextEditorState = {
    ...editorState,
    diagrams: nextDiagrams,
  }

  const nextDocument =
    documentValue && Array.isArray(documentValue.canvases)
      ? {
          ...documentValue,
          canvases: documentValue.canvases.map((canvas) =>
            renames.has(canvas.id)
              ? {
                  ...canvas,
                  name: renames.get(canvas.id),
                }
              : canvas,
          ),
        }
      : documentValue

  return {
    editorState: nextEditorState,
    documentValue: nextDocument,
    renamedCount: renames.size,
  }
}

async function main() {
  const client = await pool.connect()
  try {
    const result = await client.query(`
      SELECT id, title, editor_state, document
      FROM canvases
      ORDER BY created_at ASC
    `)

    const takenCanvasTitles = result.rows
      .map((row) => String(row.title ?? '').trim())
      .filter((title) => title && !isGenericCanvasTitle(title))

    let renamedCanvases = 0
    let renamedNestedCanvases = 0

    for (const row of result.rows) {
      const currentTitle = String(row.title ?? '').trim()
      const nextTitle = isGenericCanvasTitle(currentTitle)
        ? createUniqueCanvasName(takenCanvasTitles)
        : currentTitle

      if (isGenericCanvasTitle(currentTitle)) {
        takenCanvasTitles.push(nextTitle)
      }

      const renamed = renameGenericDiagrams(row.editor_state, row.document)
      renamedNestedCanvases += renamed.renamedCount

      if (nextTitle === currentTitle && renamed.renamedCount === 0) {
        continue
      }

      if (nextTitle !== currentTitle) {
        renamedCanvases += 1
      }

      await client.query(
        `
          UPDATE canvases
          SET title = $2,
              editor_state = $3::jsonb,
              document = $4::jsonb,
              updated_at = NOW()
          WHERE id = $1
        `,
        [row.id, nextTitle, JSON.stringify(renamed.editorState), JSON.stringify(renamed.documentValue)],
      )
    }

    console.log(
      JSON.stringify(
        {
          renamedCanvases,
          renamedNestedCanvases,
        },
        null,
        2,
      ),
    )
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
