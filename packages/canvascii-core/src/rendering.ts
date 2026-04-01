import type { CanvasDocument, CanvasObject, CanvasPoint, CanvasRenderMode, CanvasSegment } from './contracts'

export type CanvasRenderRequest = {
  document: CanvasDocument
  canvasId?: string
  mode?: CanvasRenderMode
}

export interface CanvasRenderer<Output> {
  render(request: CanvasRenderRequest): Output
}

export type CanvasTextRenderRequest = CanvasRenderRequest & {
  startRow?: number
  startCol?: number
  maxRows?: number
  maxCols?: number
  trim?: boolean
  padding?: number
}

export type CanvasTextRenderResult = {
  canvasId: string
  width: number
  height: number
  offsetRow: number
  offsetCol: number
  lines: string[]
  text: string
}

type RectangleObject = CanvasObject & {
  geometry: Extract<CanvasObject['geometry'], { type: 'rectangle' }>
}

type TextObject = CanvasObject & {
  geometry: Extract<CanvasObject['geometry'], { type: 'text' }>
}

function createGrid(rows: number, cols: number) {
  return Array.from({ length: Math.max(0, rows) }, () => Array.from({ length: Math.max(0, cols) }, () => ' '))
}

function writeCell(grid: string[][], row: number, col: number, char: string) {
  if (!grid[row] || grid[row][col] == null) return
  const nextChar = Array.from(char)[0] ?? ' '
  const current = grid[row][col]
  if (current !== ' ' && current !== nextChar && current !== '+' && nextChar !== ' ') {
    grid[row][col] = '+'
    return
  }
  grid[row][col] = nextChar
}

function segmentPoints(segment: CanvasSegment): CanvasPoint[] {
  if (segment.axis === 'horizontal') {
    const left = Math.min(segment.start.col, segment.end.col)
    const right = Math.max(segment.start.col, segment.end.col)
    return Array.from({ length: right - left + 1 }, (_, index) => ({
      row: segment.start.row,
      col: left + index,
    }))
  }

  const top = Math.min(segment.start.row, segment.end.row)
  const bottom = Math.max(segment.start.row, segment.end.row)
  return Array.from({ length: bottom - top + 1 }, (_, index) => ({
    row: top + index,
    col: segment.start.col,
  }))
}

function getCanvasBounds(document: CanvasDocument, canvasId: string) {
  const canvas = document.canvases.find((entry) => entry.id === canvasId)
  if (!canvas) {
    throw new Error(`Canvas ${canvasId} not found in document ${document.id}.`)
  }

  return {
    rows: canvas.bounds.height,
    cols: canvas.bounds.width,
  }
}

function getRenderChars(mode: CanvasRenderMode) {
  if (mode === 'UNICODE') {
    return {
      horizontal: '─',
      vertical: '│',
      topLeft: '┌',
      topRight: '┐',
      bottomLeft: '└',
      bottomRight: '┘',
    }
  }

  return {
    horizontal: '-',
    vertical: '|',
    topLeft: '+',
    topRight: '+',
    bottomLeft: '+',
    bottomRight: '+',
  }
}

function drawRectangle(grid: string[][], object: RectangleObject, mode: CanvasRenderMode) {
  const chars = getRenderChars(mode)
  const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
  const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
  const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
  const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)

  for (let col = left + 1; col < right; col += 1) {
    writeCell(grid, top, col, chars.horizontal)
    writeCell(grid, bottom, col, chars.horizontal)
  }
  for (let row = top + 1; row < bottom; row += 1) {
    writeCell(grid, row, left, chars.vertical)
    writeCell(grid, row, right, chars.vertical)
  }
  writeCell(grid, top, left, chars.topLeft)
  writeCell(grid, top, right, chars.topRight)
  writeCell(grid, bottom, left, chars.bottomLeft)
  writeCell(grid, bottom, right, chars.bottomRight)

  Array.from(object.geometry.label ?? '').forEach((char, offset) => {
    const col = left + 2 + offset
    if (col >= right) return
    writeCell(grid, top, col, String(char))
  })

  const labelLines = object.geometry.labelLines ?? []
  labelLines.forEach((line: string, index: number) => {
    const row = top + 1 + index
    if (row >= bottom) return
    Array.from(line).forEach((char, offset) => {
      const col = left + 1 + offset
      if (col >= right) return
      writeCell(grid, row, col, String(char))
    })
  })
}

function drawText(grid: string[][], object: TextObject) {
  object.geometry.lines.forEach((line: string, rowIndex: number) => {
    Array.from(line).forEach((char, colIndex) => {
      writeCell(grid, object.geometry.start.row + rowIndex, object.geometry.start.col + colIndex, String(char))
    })
  })
}

function drawLine(grid: string[][], segment: CanvasSegment, mode: CanvasRenderMode) {
  const chars = getRenderChars(mode)
  const char = segment.axis === 'horizontal' ? chars.horizontal : chars.vertical
  segmentPoints(segment).forEach((point) => {
    writeCell(grid, point.row, point.col, char)
  })
}

function trimGrid(grid: string[][], padding = 1) {
  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY
  let bottom = -1
  let right = -1

  grid.forEach((row, rowIndex) => {
    row.forEach((char, colIndex) => {
      if (char === ' ') return
      top = Math.min(top, rowIndex)
      left = Math.min(left, colIndex)
      bottom = Math.max(bottom, rowIndex)
      right = Math.max(right, colIndex)
    })
  })

  if (bottom === -1 || right === -1) {
    return {
      offsetRow: 0,
      offsetCol: 0,
      grid: [[' ']],
    }
  }

  const startRow = Math.max(0, top - padding)
  const startCol = Math.max(0, left - padding)
  const endRow = Math.min(grid.length - 1, bottom + padding)
  const endCol = Math.min(grid[0]?.length ? grid[0].length - 1 : 0, right + padding)

  return {
    offsetRow: startRow,
    offsetCol: startCol,
    grid: grid.slice(startRow, endRow + 1).map((row) => row.slice(startCol, endCol + 1)),
  }
}

function capGrid(grid: string[][], maxRows?: number, maxCols?: number) {
  const limitedRows = Number.isInteger(maxRows) ? grid.slice(0, maxRows) : grid
  return limitedRows.map((row) => (Number.isInteger(maxCols) ? row.slice(0, maxCols) : row))
}

export function renderCanvasDocumentToText(request: CanvasTextRenderRequest): CanvasTextRenderResult {
  const canvasId = request.canvasId ?? request.document.activeCanvasId
  const mode = request.mode ?? request.document.canvases.find((canvas) => canvas.id === canvasId)?.defaultRenderMode ?? 'ASCII'
  const bounds = getCanvasBounds(request.document, canvasId)
  const grid = createGrid(bounds.rows, bounds.cols)
  const objects = request.document.objects
    .filter((object) => object.canvasId === canvasId)
    .sort((left, right) => left.zIndex - right.zIndex)

  for (const object of objects) {
      switch (object.geometry.type) {
      case 'rectangle':
        drawRectangle(grid, object as RectangleObject, mode)
        break
      case 'text':
        drawText(grid, object as TextObject)
        break
      case 'line':
        drawLine(grid, object.geometry.segment, mode)
        break
      case 'polyline':
        object.geometry.segments.forEach((segment) => drawLine(grid, segment, mode))
        break
      case 'group':
        break
    }
  }

  const hasViewport = Number.isInteger(request.startRow) || Number.isInteger(request.startCol)
  const trimmed =
    hasViewport
      ? {
          offsetRow: Math.max(0, request.startRow ?? 0),
          offsetCol: Math.max(0, request.startCol ?? 0),
          grid: grid
            .slice(Math.max(0, request.startRow ?? 0))
            .map((row) => row.slice(Math.max(0, request.startCol ?? 0))),
        }
      : request.trim === false
        ? { offsetRow: 0, offsetCol: 0, grid }
        : trimGrid(grid, request.padding ?? 1)
  const capped = capGrid(trimmed.grid, request.maxRows, request.maxCols)
  const lines = capped.map((row) => row.join('').replace(/\s+$/, ''))

  return {
    canvasId,
    width: capped[0]?.length ?? 0,
    height: capped.length,
    offsetRow: trimmed.offsetRow,
    offsetCol: trimmed.offsetCol,
    lines,
    text: lines.join('\n'),
  }
}
