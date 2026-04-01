import {
  applyCanvasCommands,
  createCanvasCommandsForTransition,
  type Canvas,
  type CanvasCommand,
  type CanvasDocument,
  type CanvasEvent,
  type CanvasRegion,
} from '@canvascii/core'
import { appActions } from '@/components/asciip-core/store/appSlice'
import type { AppState } from '@/components/asciip-core/store/appSlice'
import type { DiagramData } from '@/components/asciip-core/store/diagramSlice'
import { editorStateToCanvasDocument } from '@/lib/canvascii/document-bridge'

type EditorStateCommandProjection = {
  document: CanvasDocument
  commands: CanvasCommand[]
  events: CanvasEvent[]
}

type AppStateCommandProjectionInput = {
  action?: { type: string; payload?: unknown }
  previousEditorState: AppState
  nextEditorState: AppState
  documentId?: string
  documentName?: string
  createdAt?: string
  updatedAt?: string
  actorId?: string | null
}

type DiagramStateCommandProjectionInput = {
  appState: AppState
  previousDiagramData: DiagramData
  nextDiagramData: DiagramData
  documentId?: string
  documentName?: string
  createdAt?: string
  updatedAt?: string
  actorId?: string | null
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createEmptySeedDocument(targetDocument: CanvasDocument): CanvasDocument {
  return {
    id: targetDocument.id,
    activeCanvasId: '',
    canvases: [],
    regions: [],
    objects: [],
    createdAt: targetDocument.createdAt,
    updatedAt: targetDocument.createdAt,
    version: 0,
    metadata: targetDocument.metadata,
  }
}

function createCommandId() {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `cmd:${randomPart}`
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  )

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function isSameValue(left: unknown, right: unknown) {
  return stableStringify(left) === stableStringify(right)
}

function getRootRegion(document: CanvasDocument, canvasId: string): CanvasRegion | null {
  return document.regions.find((region) => region.canvasId === canvasId) ?? null
}

function getCanvas(document: CanvasDocument, canvasId: string): Canvas | null {
  return document.canvases.find((canvas) => canvas.id === canvasId) ?? null
}

function replaceActiveDiagramData(editorState: AppState, diagramData: DiagramData): AppState {
  return {
    ...editorState,
    diagrams: editorState.diagrams.map((diagram) =>
      diagram.id === editorState.activeDiagramId
        ? {
            ...diagram,
            data: cloneSerializable(diagramData),
          }
        : diagram,
    ),
  }
}

function createDirectCommandsForActiveDiagramUpdate(input: {
  previousDocument: CanvasDocument
  nextDocument: CanvasDocument
  activeCanvasId: string
  actorId?: string | null
}): CanvasCommand[] | null {
  const previousCanvas = getCanvas(input.previousDocument, input.activeCanvasId)
  const nextCanvas = getCanvas(input.nextDocument, input.activeCanvasId)
  const previousRegion = getRootRegion(input.previousDocument, input.activeCanvasId)
  const nextRegion = getRootRegion(input.nextDocument, input.activeCanvasId)

  if (!previousCanvas || !nextCanvas || !previousRegion || !nextRegion) {
    return null
  }

  const at = input.nextDocument.updatedAt
  const actorId = input.actorId ?? null
  const commands: CanvasCommand[] = []

  if (!isSameValue(previousCanvas, nextCanvas) || !isSameValue(previousRegion, nextRegion)) {
    commands.push({
      id: createCommandId(),
      type: 'canvas.upsert',
      actorId,
      at,
      input: {
        canvas: nextCanvas,
        region: nextRegion,
      },
    })
  }

  const previousObjects = input.previousDocument.objects.filter((object) => object.canvasId === input.activeCanvasId)
  const nextObjects = input.nextDocument.objects.filter((object) => object.canvasId === input.activeCanvasId)
  const nextObjectIds = new Set(nextObjects.map((object) => object.id))

  previousObjects
    .filter((object) => !nextObjectIds.has(object.id))
    .forEach((object) => {
      commands.push({
        id: createCommandId(),
        type: 'object.delete',
        actorId,
        at,
        input: {
          objectId: object.id,
        },
      })
    })

  nextObjects.forEach((object) => {
    const previousObject = previousObjects.find((candidate) => candidate.id === object.id)
    if (!previousObject || !isSameValue(previousObject, object)) {
      commands.push({
        id: createCommandId(),
        type: 'object.upsert',
        actorId,
        at,
        input: {
          object,
        },
      })
    }
  })

  return commands
}

function createDirectCommandsForAppAction(input: {
  action: { type: string; payload?: unknown }
  previousDocument: CanvasDocument
  nextDocument: CanvasDocument
  actorId?: string | null
}): CanvasCommand[] | null {
  const at = input.nextDocument.updatedAt
  const actorId = input.actorId ?? null

  if (appActions.setActiveDiagram.match(input.action)) {
    if (!input.nextDocument.canvases.some((canvas) => canvas.id === input.nextDocument.activeCanvasId)) {
      return null
    }

    return [{
      id: createCommandId(),
      type: 'canvas.set-active',
      actorId,
      at,
      input: {
        canvasId: input.nextDocument.activeCanvasId,
      },
    }]
  }

  if (appActions.renameDiagram.match(input.action)) {
    return [{
      id: createCommandId(),
      type: 'canvas.rename',
      actorId,
      at,
      input: {
        canvasId: input.action.payload.id,
        name: input.action.payload.newName,
      },
    }]
  }

  if (appActions.createDiagram.match(input.action)) {
    const previousCanvasIds = new Set(input.previousDocument.canvases.map((canvas) => canvas.id))
    const addedCanvases = input.nextDocument.canvases.filter((canvas) => !previousCanvasIds.has(canvas.id))
    if (addedCanvases.length === 0) return null

    const commands: CanvasCommand[] = addedCanvases.flatMap((canvas) => {
      const region = getRootRegion(input.nextDocument, canvas.id)
      if (!region) return []
      return [{
        id: createCommandId(),
        type: 'canvas.create',
        actorId,
        at,
        input: {
          canvas,
          region,
        },
      } satisfies CanvasCommand]
    })

    if (input.nextDocument.activeCanvasId !== input.previousDocument.activeCanvasId) {
      commands.push({
        id: createCommandId(),
        type: 'canvas.set-active',
        actorId,
        at,
        input: {
          canvasId: input.nextDocument.activeCanvasId,
        },
      })
    }

    return commands
  }

  if (appActions.deleteDiagram.match(input.action)) {
    const nextCanvasIds = new Set(input.nextDocument.canvases.map((canvas) => canvas.id))
    const removedCanvases = input.previousDocument.canvases.filter((canvas) => !nextCanvasIds.has(canvas.id))
    const previousCanvasIds = new Set(input.previousDocument.canvases.map((canvas) => canvas.id))
    const addedCanvases = input.nextDocument.canvases.filter((canvas) => !previousCanvasIds.has(canvas.id))

    const commands: CanvasCommand[] = removedCanvases.map((canvas) => ({
      id: createCommandId(),
      type: 'canvas.delete',
      actorId,
      at,
      input: {
        canvasId: canvas.id,
      },
    }))

    addedCanvases.forEach((canvas) => {
      const region = getRootRegion(input.nextDocument, canvas.id)
      if (!region) return
      commands.push({
        id: createCommandId(),
        type: 'canvas.create',
        actorId,
        at,
        input: {
          canvas,
          region,
        },
      })
    })

    if (
      input.nextDocument.activeCanvasId &&
      input.nextDocument.activeCanvasId !== input.previousDocument.activeCanvasId &&
      getCanvas(input.nextDocument, input.nextDocument.activeCanvasId)
    ) {
      commands.push({
        id: createCommandId(),
        type: 'canvas.set-active',
        actorId,
        at,
        input: {
          canvasId: input.nextDocument.activeCanvasId,
        },
      })
    }

    return commands.length > 0 ? commands : null
  }

  if (appActions.updateDiagramData.match(input.action)) {
    return createDirectCommandsForActiveDiagramUpdate({
      previousDocument: input.previousDocument,
      nextDocument: input.nextDocument,
      activeCanvasId: input.nextDocument.activeCanvasId,
      actorId,
    })
  }

  return null
}

export function projectEditorStateThroughCommands(input: {
  previousDocument?: CanvasDocument | null
  editorState: AppState
  documentId?: string
  documentName?: string
  createdAt?: string
  updatedAt?: string
  actorId?: string | null
}): EditorStateCommandProjection {
  const targetDocument = editorStateToCanvasDocument(input.editorState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })

  const seedDocument = input.previousDocument
    ? cloneSerializable(input.previousDocument)
    : createEmptySeedDocument(targetDocument)

  const commands = createCanvasCommandsForTransition({
    previousDocument: seedDocument,
    nextDocument: targetDocument,
    actorId: input.actorId ?? null,
    at: targetDocument.updatedAt,
  })

  const applied = applyCanvasCommands(seedDocument, commands)

  return {
    document: {
      ...applied.document,
      id: targetDocument.id,
      createdAt: targetDocument.createdAt,
      updatedAt: targetDocument.updatedAt,
      metadata: targetDocument.metadata,
      version: applied.document.version,
    },
    commands,
    events: applied.events,
  }
}

export function projectAppStateTransitionThroughCommands(
  input: AppStateCommandProjectionInput,
): EditorStateCommandProjection {
  const previousDocument = editorStateToCanvasDocument(input.previousEditorState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  })

  const nextDocument = editorStateToCanvasDocument(input.nextEditorState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt ?? previousDocument.createdAt,
    updatedAt: input.updatedAt,
  })

  const directCommands = input.action
    ? createDirectCommandsForAppAction({
        action: input.action,
        previousDocument,
        nextDocument,
        actorId: input.actorId,
      })
    : null

  if (directCommands && directCommands.length > 0) {
    const applied = applyCanvasCommands(previousDocument, directCommands)

    return {
      document: {
        ...applied.document,
        id: nextDocument.id,
        createdAt: nextDocument.createdAt,
        updatedAt: nextDocument.updatedAt,
        metadata: nextDocument.metadata,
        version: applied.document.version,
      },
      commands: directCommands,
      events: applied.events,
    }
  }

  return projectEditorStateThroughCommands({
    previousDocument,
    editorState: input.nextEditorState,
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt ?? previousDocument.createdAt,
    updatedAt: input.updatedAt,
    actorId: input.actorId,
  })
}

export function projectDiagramStateTransitionThroughCommands(
  input: DiagramStateCommandProjectionInput,
): EditorStateCommandProjection {
  const activeDiagram = input.appState.diagrams.find((diagram) => diagram.id === input.appState.activeDiagramId)
  const updatedAt = input.updatedAt ?? new Date().toISOString()

  if (!activeDiagram) {
    return projectEditorStateThroughCommands({
      previousDocument: null,
      editorState: input.appState,
      documentId: input.documentId,
      documentName: input.documentName,
      createdAt: input.createdAt,
      updatedAt,
      actorId: input.actorId,
    })
  }

  const previousEditorState = replaceActiveDiagramData(input.appState, input.previousDiagramData)
  const previousDocument = editorStateToCanvasDocument(previousEditorState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt,
    updatedAt,
  })

  const previousActiveDiagramState: AppState = {
    ...previousEditorState,
    diagrams: previousEditorState.diagrams
      .filter((diagram) => diagram.id === activeDiagram.id)
      .map((diagram) => ({
        ...diagram,
        data: cloneSerializable(input.previousDiagramData),
      })),
    activeDiagramId: activeDiagram.id,
  }

  const nextActiveDiagramState: AppState = {
    ...input.appState,
    diagrams: input.appState.diagrams
      .filter((diagram) => diagram.id === activeDiagram.id)
      .map((diagram) => ({
        ...diagram,
        data: cloneSerializable(input.nextDiagramData),
      })),
    activeDiagramId: activeDiagram.id,
  }

  const previousActiveDocument = editorStateToCanvasDocument(previousActiveDiagramState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt,
    updatedAt,
  })

  const nextActiveDocument = editorStateToCanvasDocument(nextActiveDiagramState, {
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt ?? previousActiveDocument.createdAt,
    updatedAt,
  })

  const directCommands = createDirectCommandsForActiveDiagramUpdate({
    previousDocument: previousActiveDocument,
    nextDocument: nextActiveDocument,
    activeCanvasId: activeDiagram.id,
    actorId: input.actorId,
  })

  if (directCommands && directCommands.length > 0) {
    const applied = applyCanvasCommands(previousDocument, directCommands)

    return {
      document: {
        ...applied.document,
        id: previousDocument.id,
        createdAt: previousDocument.createdAt,
        updatedAt,
        metadata: previousDocument.metadata,
        version: applied.document.version,
      },
      commands: directCommands,
      events: applied.events,
    }
  }

  return projectEditorStateThroughCommands({
    previousDocument,
    editorState: replaceActiveDiagramData(input.appState, input.nextDiagramData),
    documentId: input.documentId,
    documentName: input.documentName,
    createdAt: input.createdAt ?? previousDocument.createdAt,
    updatedAt,
    actorId: input.actorId,
  })
}

export type { AppStateCommandProjectionInput, DiagramStateCommandProjectionInput, EditorStateCommandProjection }
