import type { CanvasCommand, CanvasDocument, CanvasObject, CanvasPoint, CanvasRect, CanvasSegment } from './contracts'

export type CanvasAccessMode = 'none' | 'view' | 'edit' | 'owner'
export type CanvasActorType = 'human' | 'agent' | 'system'
export type CanvasCollaboratorStatus = 'idle' | 'navigating' | 'editing' | 'streaming' | 'thinking'
export const CANVASCII_SHARE_TOKEN_QUERY_PARAM = 'share'
export const CANVASCII_SHARE_TOKEN_HEADER = 'x-canvascii-share-token'

export type CanvasShareGrant = {
  id: string
  subjectType: 'user' | 'email' | 'link'
  subjectId: string
  label?: string | null
  access: Exclude<CanvasAccessMode, 'none' | 'owner'>
  target: {
    type: 'canvas'
  } | {
    type: 'portal'
    portalId: string
  }
  createdAt: string
}

export type CanvasPortal = {
  id: string
  canvasId: string
  label: string
  rect: CanvasRect
  color: string
  createdAt: string
  updatedAt: string
}

export type CanvasSharePolicy = {
  ownerUserId: string
  ownerEmail: string | null
  grants: CanvasShareGrant[]
  portals: CanvasPortal[]
  updatedAt: string
}

export type CanvasAccessPrincipal = {
  userId: string
  email?: string | null
  shareToken?: string | null
}

export type CanvasResolvedPortalAccess = CanvasPortal & {
  access: CanvasAccessMode
}

export type CanvasAccessSummary = {
  documentId: string
  rootAccess: CanvasAccessMode
  canRead: boolean
  canEditSomewhere: boolean
  canEditAnywhere: boolean
  portals: CanvasResolvedPortalAccess[]
}

export type CanvasCollaboratorPresence = {
  userId: string
  actorId?: string | null
  actorType?: CanvasActorType
  sessionId?: string | null
  name: string | null
  color: string
  access: CanvasAccessMode
  activeTool: string | null
  status?: CanvasCollaboratorStatus
  intent?: string | null
  cursor: {
    canvasId: string
    row: number
    col: number
  } | null
  selection: {
    canvasId: string
    objectIds: string[]
    primaryObjectId: string | null
    bounds: CanvasRect | null
  } | null
  viewport: {
    canvasId: string
    rect: CanvasRect
  } | null
  draft:
    | {
        kind: 'shape'
        canvasId: string
        shape: Record<string, unknown>
        styleMode: 'ASCII' | 'UNICODE' | null
        style: Record<string, unknown> | null
      }
    | {
        kind: 'objects'
        canvasId: string
        objects: Array<{
          id: string
          shape: Record<string, unknown>
          style: Record<string, unknown> | null
        }>
        styleMode: 'ASCII' | 'UNICODE' | null
        style: Record<string, unknown> | null
      }
    | {
        kind: 'portal'
        canvasId: string
        rect: CanvasRect
      }
    | null
}

export function getCanvasCollaboratorStableId(
  collaborator: Pick<CanvasCollaboratorPresence, 'sessionId' | 'actorId' | 'userId'>,
): string {
  return collaborator.sessionId || collaborator.actorId || collaborator.userId
}

function accessRank(access: CanvasAccessMode): number {
  switch (access) {
    case 'owner':
      return 3
    case 'edit':
      return 2
    case 'view':
      return 1
    default:
      return 0
  }
}

function accessRequirementRank(required: 'view' | 'edit'): number {
  return required === 'edit' ? accessRank('edit') : accessRank('view')
}

function maxAccess(left: CanvasAccessMode, right: CanvasAccessMode): CanvasAccessMode {
  return accessRank(left) >= accessRank(right) ? left : right
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

function pointWithinRect(point: CanvasPoint, rect: CanvasRect): boolean {
  return (
    point.row >= rect.top &&
    point.row < rect.top + rect.height &&
    point.col >= rect.left &&
    point.col < rect.left + rect.width
  )
}

function normalizePointRange(left: number, right: number) {
  return {
    start: Math.min(left, right),
    end: Math.max(left, right),
  }
}

function segmentPoints(segment: CanvasSegment): CanvasPoint[] {
  if (segment.axis === 'horizontal') {
    const { start, end } = normalizePointRange(segment.start.col, segment.end.col)
    return Array.from({ length: end - start + 1 }, (_, index) => ({
      row: segment.start.row,
      col: start + index,
    }))
  }

  const { start, end } = normalizePointRange(segment.start.row, segment.end.row)
  return Array.from({ length: end - start + 1 }, (_, index) => ({
    row: start + index,
    col: segment.start.col,
  }))
}

function rectanglePoints(rect: CanvasRect): CanvasPoint[] {
  return Array.from({ length: Math.max(0, rect.height) }, (_, rowIndex) =>
    Array.from({ length: Math.max(0, rect.width) }, (_, colIndex) => ({
      row: rect.top + rowIndex,
      col: rect.left + colIndex,
    })),
  ).flat()
}

function textPoints(start: CanvasPoint, lines: string[]): CanvasPoint[] {
  const normalizedLines = lines.length > 0 ? lines : ['']
  return normalizedLines.flatMap((line, rowIndex) =>
    Array.from({ length: Math.max(1, Array.from(line).length) }, (_, colIndex) => ({
      row: start.row + rowIndex,
      col: start.col + colIndex,
    })),
  )
}

export function getCanvasObjectPoints(object: Pick<CanvasObject, 'geometry'>): CanvasPoint[] {
  switch (object.geometry.type) {
    case 'rectangle': {
      const top = Math.min(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const left = Math.min(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      const bottom = Math.max(object.geometry.topLeft.row, object.geometry.bottomRight.row)
      const right = Math.max(object.geometry.topLeft.col, object.geometry.bottomRight.col)
      return rectanglePoints({
        top,
        left,
        width: right - left + 1,
        height: bottom - top + 1,
      })
    }
    case 'line':
      return segmentPoints(object.geometry.segment)
    case 'polyline':
      return object.geometry.segments.flatMap(segmentPoints)
    case 'text':
      return textPoints(object.geometry.start, object.geometry.lines)
    case 'group':
      return []
  }
}

function grantMatchesPrincipal(grant: CanvasShareGrant, principal: CanvasAccessPrincipal): boolean {
  if (grant.subjectType === 'user') {
    return grant.subjectId === principal.userId
  }

  if (grant.subjectType === 'link') {
    return Boolean(principal.shareToken && grant.subjectId === principal.shareToken)
  }

  return Boolean(principal.email && grant.subjectId.toLowerCase() === principal.email.toLowerCase())
}

function stripCanvasVolatileFields(canvas: CanvasDocument['canvases'][number]) {
  const { updatedAt: _updatedAt, version: _version, ...rest } = canvas
  return rest
}

function stripRegionVolatileFields(region: CanvasDocument['regions'][number]) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, version: _version, ...rest } = region
  return rest
}

function isTouchOnlyCanvasUpsert(document: CanvasDocument | null | undefined, command: Extract<CanvasCommand, { type: 'canvas.upsert' }>) {
  if (!document) return false

  const previousCanvas = document.canvases.find((canvas) => canvas.id === command.input.canvas.id)
  const previousRegion = document.regions.find((region) => region.id === command.input.region.id)

  if (!previousCanvas || !previousRegion) return false

  return (
    isSameValue(stripCanvasVolatileFields(previousCanvas), stripCanvasVolatileFields(command.input.canvas)) &&
    isSameValue(stripRegionVolatileFields(previousRegion), stripRegionVolatileFields(command.input.region))
  )
}

export function createDefaultCanvasSharePolicy(input: {
  ownerUserId: string
  ownerEmail?: string | null
  updatedAt?: string
}): CanvasSharePolicy {
  return {
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail ?? null,
    grants: [],
    portals: [],
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

export function resolveCanvasAccess(
  policy: CanvasSharePolicy,
  principal: CanvasAccessPrincipal,
  documentId: string,
): CanvasAccessSummary {
  if (policy.ownerUserId === principal.userId) {
    return {
      documentId,
      rootAccess: 'owner',
      canRead: true,
      canEditSomewhere: true,
      canEditAnywhere: true,
      portals: policy.portals.map((portal) => ({
        ...portal,
        access: 'owner',
      })),
    }
  }

  let rootAccess: CanvasAccessMode = 'none'

  const matchingGrants = policy.grants.filter((grant) => grantMatchesPrincipal(grant, principal))

  matchingGrants
    .filter((grant) => grant.target.type === 'canvas')
    .forEach((grant) => {
      rootAccess = maxAccess(rootAccess, grant.access)
    })

  const portals = policy.portals.map((portal) => {
    let portalAccess = rootAccess
    matchingGrants
      .filter((grant) => grant.target.type === 'portal' && grant.target.portalId === portal.id)
      .forEach((grant) => {
        portalAccess = grant.access
      })

    return {
      ...portal,
      access: portalAccess,
    }
  })

  return {
    documentId,
    rootAccess,
    canRead: accessRank(rootAccess) > 0 || portals.some((portal) => accessRank(portal.access) > 0),
    canEditSomewhere: accessRank(rootAccess) >= 2 || portals.some((portal) => accessRank(portal.access) >= 2),
    canEditAnywhere: accessRank(rootAccess) >= 2,
    portals,
  }
}

export function resolveCanvasAccessAtPoint(
  access: CanvasAccessSummary,
  canvasId: string,
  point: CanvasPoint,
): CanvasAccessMode {
  let resolved = access.rootAccess

  access.portals
    .filter((portal) => portal.canvasId === canvasId)
    .forEach((portal) => {
      if (pointWithinRect(point, portal.rect)) {
        resolved = portal.access
      }
    })

  return resolved
}

export function hasCanvasAccessAtPoint(
  access: CanvasAccessSummary,
  canvasId: string,
  point: CanvasPoint,
  required: 'view' | 'edit' = 'view',
): boolean {
  return accessRank(resolveCanvasAccessAtPoint(access, canvasId, point)) >= accessRequirementRank(required)
}

export function hasCanvasAccessToObject(
  access: CanvasAccessSummary,
  object: Pick<CanvasObject, 'canvasId' | 'geometry'>,
  required: 'view' | 'edit' = 'view',
): boolean {
  const points = getCanvasObjectPoints(object)
  if (points.length === 0) return false
  return points.every((point) => hasCanvasAccessAtPoint(access, object.canvasId, point, required))
}

export function hasCanvasAccessToCanvas(
  access: CanvasAccessSummary,
  canvasId: string,
  required: 'view' | 'edit' = 'view',
): boolean {
  if (accessRank(access.rootAccess) >= accessRequirementRank(required)) {
    return true
  }

  return access.portals.some((portal) => portal.canvasId === canvasId && accessRank(portal.access) >= accessRequirementRank(required))
}

export function filterCanvasCommandsByAccess(input: {
  access: CanvasAccessSummary
  previousDocument?: CanvasDocument | null
  commands: CanvasCommand[]
}) {
  if (input.access.rootAccess === 'owner' || input.access.canEditAnywhere) {
    return {
      allowedCommands: input.commands,
      rejectedCommands: [] as CanvasCommand[],
    }
  }

  const allowedCommands: CanvasCommand[] = []
  const rejectedCommands: CanvasCommand[] = []

  for (const command of input.commands) {
    switch (command.type) {
      case 'canvas.upsert':
        if (isTouchOnlyCanvasUpsert(input.previousDocument, command)) {
          allowedCommands.push(command)
        } else {
          rejectedCommands.push(command)
        }
        break
      case 'canvas.set-active':
        if (hasCanvasAccessToCanvas(input.access, command.input.canvasId, 'view')) {
          allowedCommands.push(command)
        } else {
          rejectedCommands.push(command)
        }
        break
      case 'object.upsert':
        if (hasCanvasAccessToObject(input.access, command.input.object, 'edit')) {
          allowedCommands.push(command)
        } else {
          rejectedCommands.push(command)
        }
        break
      case 'object.delete': {
        const existingObject = input.previousDocument?.objects.find((object) => object.id === command.input.objectId) ?? null
        if (existingObject && hasCanvasAccessToObject(input.access, existingObject, 'edit')) {
          allowedCommands.push(command)
        } else {
          rejectedCommands.push(command)
        }
        break
      }
      default:
        rejectedCommands.push(command)
        break
    }
  }

  return {
    allowedCommands,
    rejectedCommands,
  }
}
