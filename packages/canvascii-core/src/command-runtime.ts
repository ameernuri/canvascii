import type { Canvas, CanvasCommand, CanvasDocument, CanvasEvent, CanvasObject, CanvasRegion } from './contracts'

type CanvasCommandApplication = {
  document: CanvasDocument
  events: CanvasEvent[]
}

type CanvasDocumentTransitionInput = {
  previousDocument?: CanvasDocument | null
  nextDocument: CanvasDocument
  actorId?: string | null
  at?: string
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createRuntimeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`

  return `${prefix}:${randomPart}`
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

function isSameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

function createEmptyDocument(seed: Pick<CanvasDocument, 'id' | 'createdAt' | 'updatedAt' | 'metadata'>): CanvasDocument {
  return {
    id: seed.id,
    activeCanvasId: '',
    canvases: [],
    regions: [],
    objects: [],
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    version: 0,
    metadata: seed.metadata,
  }
}

function buildEvent(command: CanvasCommand, documentId: string, type: CanvasEvent['type'], payload: CanvasEvent['payload']): CanvasEvent {
  return {
    id: createRuntimeId('evt'),
    documentId,
    commandId: command.id,
    type,
    at: command.at,
    payload,
  } as CanvasEvent
}

function upsertCanvas(canvases: Canvas[], nextCanvas: Canvas): Canvas[] {
  const index = canvases.findIndex((canvas) => canvas.id === nextCanvas.id)
  if (index === -1) return [...canvases, nextCanvas]
  const next = [...canvases]
  next[index] = nextCanvas
  return next
}

function upsertRegion(regions: CanvasRegion[], nextRegion: CanvasRegion): CanvasRegion[] {
  const filtered = regions.filter((region) => region.id !== nextRegion.id && region.canvasId !== nextRegion.canvasId)
  return [...filtered, nextRegion]
}

function upsertObject(objects: CanvasObject[], nextObject: CanvasObject): CanvasObject[] {
  const index = objects.findIndex((object) => object.id === nextObject.id)
  if (index === -1) {
    return [...objects, nextObject].sort((left, right) => left.zIndex - right.zIndex)
  }

  const next = [...objects]
  next[index] = nextObject
  return next.sort((left, right) => left.zIndex - right.zIndex)
}

function touchDocument(document: CanvasDocument, at: string): CanvasDocument {
  return {
    ...document,
    updatedAt: at,
    version: document.version + 1,
  }
}

function getRootRegion(document: CanvasDocument, canvasId: string): CanvasRegion | null {
  return document.regions.find((region) => region.canvasId === canvasId) ?? null
}

function ensureCanvasExists(document: CanvasDocument, canvasId: string): void {
  if (!document.canvases.some((canvas) => canvas.id === canvasId)) {
    throw new Error(`Canvas ${canvasId} does not exist in document ${document.id}.`)
  }
}

export function applyCanvasCommand(document: CanvasDocument | null | undefined, command: CanvasCommand): CanvasCommandApplication {
  const baseDocument = document
    ? cloneSerializable(document)
    : createEmptyDocument({
        id: `canvascii:${command.id}`,
        createdAt: command.at,
        updatedAt: command.at,
        metadata: undefined,
      })

  switch (command.type) {
    case 'canvas.create': {
      baseDocument.canvases = upsertCanvas(baseDocument.canvases, cloneSerializable(command.input.canvas))
      baseDocument.regions = upsertRegion(baseDocument.regions, cloneSerializable(command.input.region))
      if (!baseDocument.activeCanvasId) {
        baseDocument.activeCanvasId = command.input.canvas.id
      }
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'canvas.created', cloneSerializable(command.input))],
      }
    }
    case 'canvas.upsert': {
      baseDocument.canvases = upsertCanvas(baseDocument.canvases, cloneSerializable(command.input.canvas))
      baseDocument.regions = upsertRegion(baseDocument.regions, cloneSerializable(command.input.region))
      if (!baseDocument.activeCanvasId) {
        baseDocument.activeCanvasId = command.input.canvas.id
      }
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'canvas.upserted', cloneSerializable(command.input))],
      }
    }
    case 'canvas.rename': {
      ensureCanvasExists(baseDocument, command.input.canvasId)
      baseDocument.canvases = baseDocument.canvases.map((canvas) =>
        canvas.id === command.input.canvasId
          ? {
              ...canvas,
              name: command.input.name,
              updatedAt: command.at,
              version: canvas.version + 1,
            }
          : canvas,
      )
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'canvas.renamed', cloneSerializable(command.input))],
      }
    }
    case 'canvas.set-active': {
      ensureCanvasExists(baseDocument, command.input.canvasId)
      const nextDocument = touchDocument(
        {
          ...baseDocument,
          activeCanvasId: command.input.canvasId,
        },
        command.at,
      )
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'canvas.activated', cloneSerializable(command.input))],
      }
    }
    case 'canvas.delete': {
      baseDocument.canvases = baseDocument.canvases.filter((canvas) => canvas.id !== command.input.canvasId)
      baseDocument.regions = baseDocument.regions.filter((region) => region.canvasId !== command.input.canvasId)
      baseDocument.objects = baseDocument.objects.filter((object) => object.canvasId !== command.input.canvasId)
      if (baseDocument.activeCanvasId === command.input.canvasId) {
        baseDocument.activeCanvasId = baseDocument.canvases[0]?.id ?? ''
      }
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'canvas.deleted', cloneSerializable(command.input))],
      }
    }
    case 'object.upsert': {
      ensureCanvasExists(baseDocument, command.input.object.canvasId)
      baseDocument.objects = upsertObject(baseDocument.objects, cloneSerializable(command.input.object))
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'object.upserted', cloneSerializable(command.input))],
      }
    }
    case 'object.delete': {
      baseDocument.objects = baseDocument.objects.filter((object) => object.id !== command.input.objectId)
      const nextDocument = touchDocument(baseDocument, command.at)
      return {
        document: nextDocument,
        events: [buildEvent(command, nextDocument.id, 'object.deleted', cloneSerializable(command.input))],
      }
    }
  }
}

export function applyCanvasCommands(document: CanvasDocument | null | undefined, commands: CanvasCommand[]): CanvasCommandApplication {
  return commands.reduce<CanvasCommandApplication>(
    (state, command) => {
      const next = applyCanvasCommand(state.document, command)
      return {
        document: next.document,
        events: [...state.events, ...next.events],
      }
    },
    {
      document:
        document ??
        createEmptyDocument({
          id: commands[0]?.id ? `canvascii:${commands[0].id}` : 'canvascii:empty',
          createdAt: commands[0]?.at ?? new Date().toISOString(),
          updatedAt: commands[0]?.at ?? new Date().toISOString(),
          metadata: undefined,
        }),
      events: [],
    },
  )
}

export function createCanvasCommandsForTransition(input: CanvasDocumentTransitionInput): CanvasCommand[] {
  const previousDocument =
    input.previousDocument ??
    createEmptyDocument({
      id: input.nextDocument.id,
      createdAt: input.nextDocument.createdAt,
      updatedAt: input.nextDocument.createdAt,
      metadata: input.nextDocument.metadata,
    })

  const actorId = input.actorId ?? null
  const at = input.at ?? input.nextDocument.updatedAt
  const commands: CanvasCommand[] = []

  const previousCanvasIds = new Set(previousDocument.canvases.map((canvas) => canvas.id))
  const nextCanvasIds = new Set(input.nextDocument.canvases.map((canvas) => canvas.id))

  previousDocument.objects
    .filter((object) => !input.nextDocument.objects.some((nextObject) => nextObject.id === object.id))
    .forEach((object) => {
      commands.push({
        id: createRuntimeId('cmd'),
        type: 'object.delete',
        actorId,
        at,
        input: {
          objectId: object.id,
        },
      })
    })

  previousDocument.canvases
    .filter((canvas) => !nextCanvasIds.has(canvas.id))
    .forEach((canvas) => {
      commands.push({
        id: createRuntimeId('cmd'),
        type: 'canvas.delete',
        actorId,
        at,
        input: {
          canvasId: canvas.id,
        },
      })
    })

  input.nextDocument.canvases.forEach((canvas) => {
    const region = getRootRegion(input.nextDocument, canvas.id)
    if (!region) return

    const previousCanvas = previousDocument.canvases.find((candidate) => candidate.id === canvas.id)
    const previousRegion = getRootRegion(previousDocument, canvas.id)

    if (!previousCanvas || !previousCanvasIds.has(canvas.id)) {
      commands.push({
        id: createRuntimeId('cmd'),
        type: 'canvas.create',
        actorId,
        at,
        input: {
          canvas: cloneSerializable(canvas),
          region: cloneSerializable(region),
        },
      })
      return
    }

    if (!isSameValue(previousCanvas, canvas) || !isSameValue(previousRegion, region)) {
      commands.push({
        id: createRuntimeId('cmd'),
        type: 'canvas.upsert',
        actorId,
        at,
        input: {
          canvas: cloneSerializable(canvas),
          region: cloneSerializable(region),
        },
      })
    }
  })

  input.nextDocument.objects.forEach((object) => {
    const previousObject = previousDocument.objects.find((candidate) => candidate.id === object.id)
    if (!previousObject || !isSameValue(previousObject, object)) {
      commands.push({
        id: createRuntimeId('cmd'),
        type: 'object.upsert',
        actorId,
        at,
        input: {
          object: cloneSerializable(object),
        },
      })
    }
  })

  if (
    input.nextDocument.activeCanvasId &&
    input.nextDocument.activeCanvasId !== previousDocument.activeCanvasId &&
    input.nextDocument.canvases.some((canvas) => canvas.id === input.nextDocument.activeCanvasId)
  ) {
    commands.push({
      id: createRuntimeId('cmd'),
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

export type { CanvasCommandApplication, CanvasDocumentTransitionInput }
