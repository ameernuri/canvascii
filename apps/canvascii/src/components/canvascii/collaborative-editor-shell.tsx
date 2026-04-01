'use client'

import {
  CANVASCII_YDOC_DOCUMENT_KEY,
  CANVASCII_YDOC_LEGACY_STATE_KEY,
  CANVASCII_YDOC_ROOT_KEY,
  applyCanvasCommands,
  createPortalMirrorCommands,
  filterCanvasCommandsByAccess,
  getCanvasCollaboratorStableId,
  mapPointAcrossPortals,
  type CanvasAccessSummary,
  type CanvasAccessMode,
  type CanvasCollaboratorPresence,
} from '@canvascii/core'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Y from 'yjs'
import { AsciipEditorShell } from '@/components/asciip-core/asciip-editor-shell'
import type { AppState } from '@/components/asciip-core/store/appSlice'
import type { AsciipCommittedState } from '@/components/asciip-core/store/middleware'
import type { AuthUser } from '@/lib/auth-client'
import type { EditorCollaborationProps, EditorInteractionMeta, EditorTerminalPreview } from '@/lib/canvascii/collaboration'
import { resolvePresenceViewport } from '@/lib/canvascii/collaboration'
import { canvasDocumentToEditorState, editorStateToCanvasDocument } from '@/lib/canvascii/document-bridge'
import { projectEditorStateThroughCommands } from '@/lib/canvascii/command-projection'
import { canvasciiCollabConfig } from '@/lib/collab-config'

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return 'null'
  }
}

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function ensureProjectedDocument(input: {
  projectedDocument: ReturnType<typeof editorStateToCanvasDocument>
  editorState: AppState
  documentId: string
  updatedAt?: string
}): ReturnType<typeof editorStateToCanvasDocument> {
  if (input.projectedDocument.canvases.length > 0) {
    return input.projectedDocument
  }

  return editorStateToCanvasDocument(input.editorState, {
    documentId: input.documentId,
    updatedAt: input.updatedAt,
  })
}

function isUsableCanvasDocument(value: unknown): value is ReturnType<typeof editorStateToCanvasDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as ReturnType<typeof editorStateToCanvasDocument>
  return Array.isArray(candidate.canvases) && candidate.canvases.length > 0
}

function colorFromId(value: string): string {
  const palette = ['#38bdf8', '#f97316', '#22c55e', '#f43f5e', '#a855f7', '#facc15']
  const hash = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return palette[hash % palette.length]
}

const PRESENCE_STALE_AFTER_MS = 30_000

function isFreshCollaboratorPresence(
  presence: CanvasCollaboratorPresence & { updatedAt?: string },
  now = Date.now(),
) {
  const updatedAt = typeof presence.updatedAt === 'string' ? presence.updatedAt.trim() : ''
  if (!updatedAt) {
    return (presence.actorType ?? 'human') !== 'agent'
  }

  const timestamp = Date.parse(updatedAt)
  if (!Number.isFinite(timestamp)) {
    return (presence.actorType ?? 'human') !== 'agent'
  }

  return now - timestamp <= PRESENCE_STALE_AFTER_MS
}

export function shouldWriteSharedState(input: {
  hasProvider: boolean
  lastSharedJson: string
  nextJson: string
  pendingLocalCommitStateJson?: string | null
}) {
  if (input.nextJson === input.lastSharedJson) {
    return {
      shouldWrite: false,
      usedPendingLocalCommit: false,
    }
  }

  const usedPendingLocalCommit = input.pendingLocalCommitStateJson === input.nextJson
  if (input.hasProvider && !usedPendingLocalCommit) {
    return {
      shouldWrite: false,
      usedPendingLocalCommit: false,
    }
  }

  return {
    shouldWrite: true,
    usedPendingLocalCommit,
  }
}

function createCollabSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `session:${crypto.randomUUID()}`
  }

  return `session:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function createCollabActorId(prefix: 'agent' | 'human' = 'agent'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}:${crypto.randomUUID()}`
  }

  return `${prefix}:${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const MIRROR_AGENT_NAME = 'Mirror agent'
const MIRROR_AGENT_COLOR = '#f97316'

function getMirrorStorageKey(documentId: string) {
  return `canvascii:portal-mirror:${documentId}`
}

function isMirrorConfigEnabled(input: { sourcePortalId: string | null; targetPortalId: string | null }) {
  return Boolean(input.sourcePortalId && input.targetPortalId && input.sourcePortalId !== input.targetPortalId)
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

function pointWithinPortal(
  point: { row: number; col: number },
  portal: { rect: CanvasAccessSummary['portals'][number]['rect'] },
): boolean {
  return (
    point.row >= portal.rect.top &&
    point.row < portal.rect.top + portal.rect.height &&
    point.col >= portal.rect.left &&
    point.col < portal.rect.left + portal.rect.width
  )
}

export function resolvePresenceCursor(
  accessSummary: CanvasAccessSummary,
  meta: EditorInteractionMeta | null,
): CanvasCollaboratorPresence['cursor'] {
  const hoveredCell = meta?.textCursorCell ?? meta?.hoveredCell
  if (!hoveredCell || !meta) return null

  const rootAccessRank = accessRank(accessSummary.rootAccess)
  const hasPortalScopedOverride = accessSummary.portals.some(
    (portal) => accessRank(portal.access) > rootAccessRank,
  )

  if (!hasPortalScopedOverride) {
    return {
      canvasId: meta.activeCanvasId,
      row: hoveredCell.row,
      col: hoveredCell.col,
    }
  }

  const visiblePortal = accessSummary.portals.find(
    (portal) =>
      portal.canvasId === meta.activeCanvasId &&
      accessRank(portal.access) > 0 &&
      pointWithinPortal(hoveredCell, portal),
  )

  if (!visiblePortal) return null

  return {
    canvasId: meta.activeCanvasId,
    row: hoveredCell.row,
    col: hoveredCell.col,
  }
}

function buildLocalPresence(input: {
  userId: string
  actorId: string
  actorType: 'human'
  name: string
  color: string
  currentCollaboratorName?: string | null
  accessSummary: CanvasAccessSummary
  meta: EditorInteractionMeta | null
  sessionId: string
}): CanvasCollaboratorPresence {
  const hasDraft = Boolean(input.meta?.draftPortalBounds || input.meta?.draftShape || input.meta?.draftObjects?.length)
  const hasCursor = Boolean(input.meta?.textCursorCell ?? input.meta?.hoveredCell)

  return {
    userId: input.userId,
    actorId: input.actorId,
    actorType: input.actorType,
    sessionId: input.sessionId,
    name: input.currentCollaboratorName ?? input.name,
    color: input.color,
    access: input.accessSummary.rootAccess === 'owner' ? 'owner' : input.accessSummary.canEditSomewhere ? 'edit' : 'view',
    activeTool: input.meta?.activeTool ?? null,
    status: hasDraft ? 'editing' : hasCursor ? 'navigating' : 'idle',
    intent: input.meta?.activeTool ? `tool:${input.meta.activeTool}` : null,
    cursor: resolvePresenceCursor(input.accessSummary, input.meta),
    selection:
      input.meta?.selectedObjectIds.length
        ? {
            canvasId: input.meta.activeCanvasId,
            objectIds: [...input.meta.selectedObjectIds],
            primaryObjectId: input.meta.selectedObjectIds[0] ?? null,
            bounds: input.meta.selectedBounds ?? null,
          }
        : null,
    viewport: resolvePresenceViewport(input.accessSummary, input.meta),
    draft:
      input.meta?.draftPortalBounds
        ? {
            kind: 'portal',
            canvasId: input.meta.activeCanvasId,
            rect: input.meta.draftPortalBounds,
          }
        : input.meta?.draftObjects?.length
          ? {
              kind: 'objects',
              canvasId: input.meta.activeCanvasId,
              objects: input.meta.draftObjects,
              styleMode: input.meta.draftStyleMode,
              style: input.meta.draftStyle,
            }
        : input.meta?.draftShape
          ? {
              kind: 'shape',
              canvasId: input.meta.activeCanvasId,
              shape: input.meta.draftShape,
              styleMode: input.meta.draftStyleMode,
              style: input.meta.draftStyle,
            }
          : null,
  }
}

export function CollaborativeEditorShell({
  documentId,
  editorState,
  sourceStateVersion,
  onEditorStateChange,
  onLiveEditorStateChange,
  onAcceptedLocalCommit,
  onLocalCommandBatch,
  collabToken,
  currentUser,
  currentCollaboratorName,
  accessSummary,
  canManagePortals,
  onEditorMetaChange,
  onCollaboratorsChange,
  onCreateFenceFromBounds,
  onUpdateFence,
  onDeleteFence,
  onOpenFenceShare,
  toolbarLeading,
  toolbarFullscreen,
  toolbarTrailing,
  onFenceDraftBoundsChange,
  canCreatePortalDocuments,
  onResolvePortalTarget,
  onOpenPortalDestination,
  portalTargetShapeMap,
  componentDefinitionMap,
  portalNavigationFocus,
  onPortalNavigationFocusHandled,
  onDismissPortalNavigationFocus,
  terminalPreview,
  onRequestCreateComponentFromSelection,
  showHistory,
  focusPoint,
  showCollaboratorOverlays,
}: {
  documentId: string
  editorState: Record<string, unknown> | null
  sourceStateVersion?: string | null
  onEditorStateChange: (next: AppState) => void
  onLiveEditorStateChange?: (next: AppState) => void
  onAcceptedLocalCommit?: (commit: AsciipCommittedState) => void
  onLocalCommandBatch?: (commit: AsciipCommittedState) => void
  collabToken?: string | null
  currentUser?: AuthUser | null
  currentCollaboratorName?: string | null
  accessSummary?: CanvasAccessSummary | null
  canManagePortals?: boolean
  onEditorMetaChange?: (meta: EditorInteractionMeta) => void
  onCollaboratorsChange?: (collaborators: CanvasCollaboratorPresence[]) => void
  onCreateFenceFromBounds?: (bounds: {
    top: number
    left: number
    width: number
    height: number
  }) => Promise<void>
  onUpdateFence?: (input: {
    fenceId: string
    top: number
    left: number
    width: number
    height: number
  }) => Promise<void>
  onDeleteFence?: (fenceId: string) => Promise<void>
  onOpenFenceShare?: (fenceId: string) => void
  onFenceDraftBoundsChange?: (bounds: {
    top: number
    left: number
    width: number
    height: number
  } | null) => void
  canCreatePortalDocuments?: boolean
  onResolvePortalTarget?: EditorCollaborationProps['onResolvePortalTarget']
  onOpenPortalDestination?: EditorCollaborationProps['onOpenPortalDestination']
  portalTargetShapeMap?: EditorCollaborationProps['portalTargetShapeMap']
  componentDefinitionMap?: EditorCollaborationProps['componentDefinitionMap']
  portalNavigationFocus?: EditorCollaborationProps['portalNavigationFocus']
  onPortalNavigationFocusHandled?: EditorCollaborationProps['onPortalNavigationFocusHandled']
  onDismissPortalNavigationFocus?: EditorCollaborationProps['onDismissPortalNavigationFocus']
  terminalPreview?: EditorTerminalPreview | null
  onRequestCreateComponentFromSelection?: EditorCollaborationProps['onRequestCreateComponentFromSelection']
  showHistory?: boolean
  focusPoint?: {
    row: number
    col: number
    key: string
  } | null
  showCollaboratorOverlays?: boolean
  toolbarLeading?: ReactNode
  toolbarFullscreen?: ReactNode
  toolbarTrailing?: ReactNode
}) {
  const [sharedEditorState, setSharedEditorState] = useState<Record<string, unknown> | null>(editorState)
  const [liveEditorState, setLiveEditorState] = useState<Record<string, unknown> | null>(editorState)
  const [collaborators, setCollaborators] = useState<CanvasCollaboratorPresence[]>([])
  const [portalMirrorConfig, setPortalMirrorConfig] = useState<{
    sourcePortalId: string | null
    targetPortalId: string | null
  }>({
    sourcePortalId: null,
    targetPortalId: null,
  })
  const isPortalMirrorEnabled = useMemo(
    () => isMirrorConfigEnabled(portalMirrorConfig),
    [portalMirrorConfig],
  )
  const onEditorStateChangeRef = useRef(onEditorStateChange)
  const onLiveEditorStateChangeRef = useRef(onLiveEditorStateChange)
  const onAcceptedLocalCommitRef = useRef(onAcceptedLocalCommit)
  const onLocalCommandBatchRef = useRef(onLocalCommandBatch)
  const editorStateRef = useRef(editorState)
  const collabStateRef = useRef<{
    doc: Y.Doc
    root: Y.Map<unknown>
    provider: HocuspocusProvider | null
    persistence: IndexeddbPersistence | null
  } | null>(null)
  const mirrorStateRef = useRef<{
    doc: Y.Doc
    root: Y.Map<unknown>
    provider: HocuspocusProvider | null
  } | null>(null)
  const lastSharedJsonRef = useRef(stableJson(editorState))
  const lastSharedEditorStateJsonRef = useRef(stableJson(editorState))
  const lastLiveEditorStateJsonRef = useRef(stableJson(editorState))
  const localSessionIdRef = useRef<string>(createCollabSessionId())
  const mirrorSessionIdRef = useRef<string>(createCollabSessionId())
  const mirrorActorIdRef = useRef<string>(createCollabActorId('agent'))
  const pendingLocalCommitRef = useRef<{
    stateJson: string
    commit: AsciipCommittedState
  } | null>(null)
  const latestMetaRef = useRef<EditorInteractionMeta | null>(null)
  const pendingMetaRef = useRef<EditorInteractionMeta | null>(null)
  const metaPublishFrameRef = useRef<number | null>(null)
  const lastPresenceJsonRef = useRef<string | null>(null)
  const lastMirrorPresenceJsonRef = useRef<string | null>(null)
  const lastCollaboratorsJsonRef = useRef<string>('[]')
  const lastAppliedSourceStateVersionRef = useRef<string | null>(null)
  onEditorStateChangeRef.current = onEditorStateChange
  onLiveEditorStateChangeRef.current = onLiveEditorStateChange
  onAcceptedLocalCommitRef.current = onAcceptedLocalCommit
  onLocalCommandBatchRef.current = onLocalCommandBatch
  editorStateRef.current = editorState
  const isShareLinkSession = typeof collabToken === 'string' && collabToken.startsWith('share:')

  const localIdentity = useMemo(() => {
    if (!accessSummary) return null

    if (currentUser?.id) {
      return {
        userId: currentUser.id,
        actorId: `human:${currentUser.id}`,
        actorType: 'human' as const,
        name: currentUser.name ?? currentUser.email ?? 'Collaborator',
        color: colorFromId(currentUser.id),
      }
    }

    if (typeof collabToken === 'string' && collabToken.startsWith('share:')) {
      const token = collabToken.slice('share:'.length)
      const shareActorId = `link:${token}`
      return {
        userId: shareActorId,
        actorId: shareActorId,
        actorType: 'human' as const,
        name: currentCollaboratorName ?? 'Shared collaborator',
        color: colorFromId(shareActorId),
      }
    }

    return null
  }, [accessSummary, collabToken, currentCollaboratorName, currentUser?.email, currentUser?.id, currentUser?.name])

  const localPresence = useMemo<CanvasCollaboratorPresence | null>(() => {
    if (!localIdentity || !accessSummary) return null
    return buildLocalPresence({
      ...localIdentity,
      currentCollaboratorName,
      accessSummary,
      meta: latestMetaRef.current,
      sessionId: localSessionIdRef.current,
    })
  }, [accessSummary, currentCollaboratorName, localIdentity])

  const publishPresence = useCallback((meta: EditorInteractionMeta | null) => {
    latestMetaRef.current = meta
    const awareness = collabStateRef.current?.provider?.awareness
    if (!awareness || !localIdentity || !accessSummary) return
    const nextPresence = buildLocalPresence({
      ...localIdentity,
      currentCollaboratorName,
      accessSummary,
      meta,
      sessionId: localSessionIdRef.current,
    }) satisfies CanvasCollaboratorPresence
    const nextPresenceJson = stableJson(nextPresence)
    if (nextPresenceJson === lastPresenceJsonRef.current) return
    lastPresenceJsonRef.current = nextPresenceJson
    awareness.setLocalStateField('presence', nextPresence)
  }, [accessSummary, currentCollaboratorName, localIdentity])

  const resolveMirrorTargets = useCallback((input: {
    canvasId: string | null | undefined
  }) => {
    const canvasId = input.canvasId ?? null
    if (!isPortalMirrorEnabled || !accessSummary?.portals?.length || !canvasId) {
      return {
        sourceBox: null,
        targetBox: null,
        ignoredObjectIds: new Set<string>(),
      }
    }

    const sourcePortal =
      accessSummary.portals.find(
        (portal) => portal.id === portalMirrorConfig.sourcePortalId && portal.canvasId === canvasId,
      ) ?? null
    const targetPortal =
      accessSummary.portals.find(
        (portal) => portal.id === portalMirrorConfig.targetPortalId && portal.canvasId === canvasId,
      ) ?? null

    return {
      sourceBox: sourcePortal ?? null,
      targetBox: targetPortal ?? null,
      ignoredObjectIds: new Set<string>(),
    }
  }, [accessSummary?.portals, isPortalMirrorEnabled, portalMirrorConfig.sourcePortalId, portalMirrorConfig.targetPortalId])

  const publishMirrorPresence = useCallback((meta: EditorInteractionMeta | null) => {
    if (!isPortalMirrorEnabled) return
    const awareness = mirrorStateRef.current?.provider?.awareness
    if (!awareness) return

    const { sourceBox, targetBox } = resolveMirrorTargets({
      canvasId: meta?.activeCanvasId ?? null,
    })
    const sourceCursor = meta?.textCursorCell ?? meta?.hoveredCell ?? null
    const mirroredCursor =
      sourceBox && targetBox && sourceCursor && pointWithinPortal(sourceCursor, sourceBox)
        ? {
            canvasId: targetBox.canvasId,
            ...mapPointAcrossPortals(sourceCursor, sourceBox, targetBox),
          }
        : null
    const sourceViewport = meta?.viewportBounds ?? null
    const mirroredViewport =
      sourceBox && targetBox && sourceViewport
        ? (() => {
            const sourceBottomRight = {
              row: sourceViewport.top + sourceViewport.height - 1,
              col: sourceViewport.left + sourceViewport.width - 1,
            }
            if (
              !pointWithinPortal({ row: sourceViewport.top, col: sourceViewport.left }, sourceBox) ||
              !pointWithinPortal(sourceBottomRight, sourceBox)
            ) {
              return null
            }

            const mappedTopLeft = mapPointAcrossPortals(
              { row: sourceViewport.top, col: sourceViewport.left },
              sourceBox,
              targetBox,
            )
            const mappedBottomRight = mapPointAcrossPortals(sourceBottomRight, sourceBox, targetBox)
            return {
              canvasId: targetBox.canvasId,
              rect: {
                top: Math.min(mappedTopLeft.row, mappedBottomRight.row),
                left: Math.min(mappedTopLeft.col, mappedBottomRight.col),
                width: Math.abs(mappedBottomRight.col - mappedTopLeft.col) + 1,
                height: Math.abs(mappedBottomRight.row - mappedTopLeft.row) + 1,
              },
            }
          })()
        : null

    const hasDraft = Boolean(meta?.draftPortalBounds || meta?.draftShape)
    const nextPresence: CanvasCollaboratorPresence = {
      userId: mirrorActorIdRef.current,
      actorId: mirrorActorIdRef.current,
      actorType: 'agent',
      sessionId: mirrorSessionIdRef.current,
      name: MIRROR_AGENT_NAME,
      color: MIRROR_AGENT_COLOR,
      access: accessSummary?.canEditSomewhere ? 'edit' : 'view',
      activeTool: meta?.activeTool ?? 'SELECT',
      status: hasDraft ? 'editing' : mirroredCursor ? 'navigating' : 'idle',
      intent:
        sourceBox && targetBox
          ? `mirroring ${sourceBox.label} -> ${targetBox.label}`
          : 'waiting for source and target portals',
      cursor: mirroredCursor,
      selection: null,
      viewport: mirroredViewport,
      draft: null,
    }

    const nextPresenceJson = stableJson(nextPresence)
    if (nextPresenceJson === lastMirrorPresenceJsonRef.current) return
    lastMirrorPresenceJsonRef.current = nextPresenceJson
    awareness.setLocalStateField('presence', nextPresence)
  }, [accessSummary?.canEditSomewhere, isPortalMirrorEnabled, resolveMirrorTargets])

  const applyPortalMirrorCommit = useCallback((input: {
    previousDocument: ReturnType<typeof editorStateToCanvasDocument> | null
    nextDocument: ReturnType<typeof editorStateToCanvasDocument>
    commands: AsciipCommittedState['projection']['commands']
  }) => {
    if (!isPortalMirrorEnabled) return
    const mirrorState = mirrorStateRef.current
    if (!mirrorState) return

    const { sourceBox, targetBox, ignoredObjectIds } = resolveMirrorTargets({
      canvasId: input.nextDocument.activeCanvasId,
    })
    if (!sourceBox || !targetBox) return

    const mirrorCommands = createPortalMirrorCommands({
      previousDocument: input.previousDocument,
      nextDocument: input.nextDocument,
      commands: input.commands.filter((command) => {
        if (command.type === 'object.upsert') {
          return !ignoredObjectIds.has(command.input.object.id)
        }

        if (command.type === 'object.delete') {
          return !ignoredObjectIds.has(command.input.objectId)
        }

        return false
      }),
      sourcePortal: sourceBox,
      targetPortal: targetBox,
      actorId: mirrorActorIdRef.current,
      at: input.nextDocument.updatedAt,
    })

    if (mirrorCommands.length === 0) return

    const currentMirrorDocument = mirrorState.root.get(CANVASCII_YDOC_DOCUMENT_KEY)
    const baseDocument =
      isUsableCanvasDocument(currentMirrorDocument) &&
      currentMirrorDocument.canvases.some((canvas) => canvas.id === targetBox.canvasId)
        ? currentMirrorDocument
        : input.nextDocument

    if (!baseDocument) return

    const mirrored = applyCanvasCommands(baseDocument, mirrorCommands).document
    mirrorState.doc.transact(() => {
      mirrorState.root.set(CANVASCII_YDOC_DOCUMENT_KEY, cloneState(mirrored))
    }, mirrorActorIdRef.current)
  }, [isPortalMirrorEnabled, resolveMirrorTargets])

  const applySharedEditorState = useCallback((next: Record<string, unknown> | null) => {
    const nextJson = stableJson(next)
    if (nextJson === lastSharedEditorStateJsonRef.current) {
      return
    }
    lastSharedEditorStateJsonRef.current = nextJson
    setSharedEditorState(next)
  }, [])

  const applyLiveEditorState = useCallback((next: Record<string, unknown> | null) => {
    const nextJson = stableJson(next)
    if (nextJson === lastLiveEditorStateJsonRef.current) {
      return
    }
    lastLiveEditorStateJsonRef.current = nextJson
    setLiveEditorState(next)
  }, [])

  const handleLiveEditorStateChange = useCallback((next: AppState) => {
    applyLiveEditorState(next)
    onLiveEditorStateChangeRef.current?.(next)
  }, [applyLiveEditorState])

  const handleCommandBatch = useCallback((commit: AsciipCommittedState) => {
    onLocalCommandBatchRef.current?.(commit)
    pendingLocalCommitRef.current = {
      stateJson: stableJson(commit.state),
      commit,
    }
  }, [])

  const handleAsciipEditorMetaChange = useCallback(
    (meta: EditorInteractionMeta) => {
      pendingMetaRef.current = meta
      if (metaPublishFrameRef.current != null) {
        return
      }
      metaPublishFrameRef.current = window.requestAnimationFrame(() => {
        metaPublishFrameRef.current = null
        const pendingMeta = pendingMetaRef.current
        pendingMetaRef.current = null
        if (!pendingMeta) return
        publishPresence(pendingMeta)
        publishMirrorPresence(pendingMeta)
        onEditorMetaChange?.(pendingMeta)
      })
    },
    [onEditorMetaChange, publishMirrorPresence, publishPresence],
  )

  useEffect(() => {
    if (!documentId) {
      lastCollaboratorsJsonRef.current = '[]'
      setCollaborators([])
    }
  }, [documentId])

  useEffect(() => {
    return () => {
      if (metaPublishFrameRef.current != null) {
        window.cancelAnimationFrame(metaPublishFrameRef.current)
        metaPublishFrameRef.current = null
      }
      pendingMetaRef.current = null
    }
  }, [])

  useEffect(() => {
    onCollaboratorsChange?.(collaborators)
  }, [collaborators, onCollaboratorsChange])

  useEffect(() => {
    const nextJson = stableJson(editorState)
    lastSharedJsonRef.current = nextJson
    lastSharedEditorStateJsonRef.current = nextJson
    lastLiveEditorStateJsonRef.current = nextJson
    setSharedEditorState(editorState)
    setLiveEditorState(editorState)
    lastAppliedSourceStateVersionRef.current = sourceStateVersion ?? null
  }, [documentId])

  useEffect(() => {
    // External callers like the bottom command terminal can replace the parent
    // editor state directly. Keep the live shell in sync with that newer state
    // so command-driven edits appear immediately instead of waiting on a shared
    // document echo path.
    applyLiveEditorState(editorState)
  }, [applyLiveEditorState, editorState])

  useEffect(() => {
    if (!sourceStateVersion || lastAppliedSourceStateVersionRef.current === sourceStateVersion) return
    if (!editorState) return

    const active = collabStateRef.current
    if (!active) return

    const sourceAppState = editorState as AppState
    const currentDocument = active.root.get(CANVASCII_YDOC_DOCUMENT_KEY)
    const previousDocument = isUsableCanvasDocument(currentDocument)
      ? cloneState(currentDocument)
      : null
    const nextJson = stableJson(sourceAppState)
    const currentJson = previousDocument
      ? stableJson(canvasDocumentToEditorState(previousDocument))
      : stableJson(active.root.get(CANVASCII_YDOC_LEGACY_STATE_KEY))

    lastAppliedSourceStateVersionRef.current = sourceStateVersion
    if (currentJson === nextJson) {
      lastSharedJsonRef.current = nextJson
      applySharedEditorState(sourceAppState)
      applyLiveEditorState(sourceAppState)
      return
    }

    // When a newer saved canvas snapshot arrives from the parent, treat it as
    // authoritative so a stale local/room snapshot cannot overwrite it on reload.
    const projection = projectEditorStateThroughCommands({
      previousDocument,
      editorState: sourceAppState,
      documentId,
      updatedAt: new Date().toISOString(),
    })
    const nextDocument = ensureProjectedDocument({
      projectedDocument: projection.document,
      editorState: sourceAppState,
      documentId,
    })

    active.doc.transact(() => {
      active.root.set(CANVASCII_YDOC_DOCUMENT_KEY, cloneState(nextDocument))
      active.root.set(CANVASCII_YDOC_LEGACY_STATE_KEY, cloneState(sourceAppState))
    }, 'authoritative-source-sync')

    lastSharedJsonRef.current = nextJson
    applySharedEditorState(sourceAppState)
    applyLiveEditorState(sourceAppState)
  }, [applyLiveEditorState, applySharedEditorState, documentId, editorState, sourceStateVersion])

  useEffect(() => {
    const portals = accessSummary?.portals ?? []
    const stored =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(getMirrorStorageKey(documentId))
        : null

    let parsed: { enabled?: boolean; sourcePortalId?: string | null; targetPortalId?: string | null } | null = null
    if (stored) {
      try {
        parsed = JSON.parse(stored) as { enabled?: boolean; sourcePortalId?: string | null; targetPortalId?: string | null }
      } catch {
        parsed = null
      }
    }

    const hasPortal = (portalId: string | null | undefined) =>
      Boolean(portalId && portals.some((portal) => portal.id === portalId))

    const storedSource =
      parsed?.enabled && parsed.sourcePortalId && hasPortal(parsed.sourcePortalId)
        ? parsed.sourcePortalId
        : null
    const storedTarget =
      parsed?.enabled && parsed.targetPortalId && hasPortal(parsed.targetPortalId)
        ? parsed.targetPortalId
        : null

    setPortalMirrorConfig((current) => {
      const next = {
        sourcePortalId: hasPortal(current.sourcePortalId) ? current.sourcePortalId : storedSource,
        targetPortalId:
          hasPortal(current.targetPortalId) &&
          current.targetPortalId !== (hasPortal(current.sourcePortalId) ? current.sourcePortalId : storedSource)
            ? current.targetPortalId
            : storedTarget,
      }

      if (
        current.sourcePortalId === next.sourcePortalId &&
        current.targetPortalId === next.targetPortalId
      ) {
        return current
      }

      return next
    })
  }, [accessSummary?.portals, documentId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(
      getMirrorStorageKey(documentId),
      JSON.stringify({
        enabled: isPortalMirrorEnabled,
        ...portalMirrorConfig,
      }),
    )
  }, [documentId, isPortalMirrorEnabled, portalMirrorConfig])

  useEffect(() => {
    const providerToken =
      documentId !== '__scratch__' && accessSummary?.canRead && isPortalMirrorEnabled ? collabToken ?? null : null
    if (!providerToken) {
      mirrorStateRef.current = null
      return
    }

    const doc = new Y.Doc()
    const root = doc.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
    const provider = new HocuspocusProvider({
      url: canvasciiCollabConfig.url,
      name: `canvascii:${documentId}`,
      document: doc,
      token: providerToken,
    })

    mirrorStateRef.current = {
      doc,
      root,
      provider,
    }

    const syncMirrorPresence = () => {
      publishMirrorPresence(latestMetaRef.current)
    }

    provider.on('synced', syncMirrorPresence)
    syncMirrorPresence()

    return () => {
      provider.off('synced', syncMirrorPresence)
      provider.destroy()
      doc.destroy()
      mirrorStateRef.current = null
      lastMirrorPresenceJsonRef.current = null
    }
  }, [accessSummary?.canRead, collabToken, documentId, isPortalMirrorEnabled, publishMirrorPresence])

  useEffect(() => {
    const doc = new Y.Doc()
    const root = doc.getMap<unknown>(CANVASCII_YDOC_ROOT_KEY)
    const roomName = `canvascii:${documentId}`
    const persistence = isShareLinkSession ? null : new IndexeddbPersistence(roomName, doc)
    const providerToken = documentId !== '__scratch__' && accessSummary?.canRead ? collabToken ?? null : null
    const provider =
      providerToken
        ? new HocuspocusProvider({
            url: canvasciiCollabConfig.url,
            name: roomName,
            document: doc,
            token: providerToken,
          })
        : null

    collabStateRef.current = { doc, root, provider, persistence }
    let providerSynced = !provider

    const syncAwareness = () => {
      const awareness = provider?.awareness
      if (!awareness) {
        lastCollaboratorsJsonRef.current = '[]'
        setCollaborators([])
        return
      }

      const nextCollaborators = Array.from(awareness.getStates().values())
        .map((state) => state?.presence as CanvasCollaboratorPresence | undefined)
        .filter((presence): presence is CanvasCollaboratorPresence => Boolean(presence))
        .filter((presence) => isFreshCollaboratorPresence(presence))
        .filter((presence) => getCanvasCollaboratorStableId(presence) !== localSessionIdRef.current)

      const nextCollaboratorsJson = stableJson(nextCollaborators)
      if (nextCollaboratorsJson === lastCollaboratorsJsonRef.current) {
        return
      }
      lastCollaboratorsJsonRef.current = nextCollaboratorsJson
      setCollaborators(nextCollaborators)
    }

    const syncFromDoc = () => {
      const nextDocument = root.get(CANVASCII_YDOC_DOCUMENT_KEY)
      if (isUsableCanvasDocument(nextDocument)) {
        const nextState = canvasDocumentToEditorState(nextDocument)
        const nextJson = stableJson(nextState)
        if (nextJson === lastSharedJsonRef.current) return

        lastSharedJsonRef.current = nextJson
        const cloned = cloneState(nextState)
        applySharedEditorState(cloned)
        if (!pendingLocalCommitRef.current || pendingLocalCommitRef.current.stateJson === nextJson) {
          applyLiveEditorState(cloned)
        }
        onEditorStateChangeRef.current(cloned)
        return
      }

      const next = root.get(CANVASCII_YDOC_LEGACY_STATE_KEY)
      if (!next || typeof next !== 'object' || Array.isArray(next)) return

      const nextJson = stableJson(next)
      if (nextJson === lastSharedJsonRef.current) return

      lastSharedJsonRef.current = nextJson
      const cloned = cloneState(next as Record<string, unknown>)
      applySharedEditorState(cloned)
      if (!pendingLocalCommitRef.current || pendingLocalCommitRef.current.stateJson === nextJson) {
        applyLiveEditorState(cloned)
      }
      onEditorStateChangeRef.current(cloned as AppState)
    }

    const bootstrapIfNeeded = () => {
      if (!editorStateRef.current) return
      if (!providerSynced) return
      const existingDocument = root.get(CANVASCII_YDOC_DOCUMENT_KEY)
      if (isUsableCanvasDocument(existingDocument)) return
      const projection = projectEditorStateThroughCommands({
        previousDocument: null,
        editorState: editorStateRef.current as AppState,
        documentId,
        updatedAt: new Date().toISOString(),
      })
      const nextDocument = ensureProjectedDocument({
        projectedDocument: projection.document,
        editorState: editorStateRef.current as AppState,
        documentId,
      })
      root.set(
        CANVASCII_YDOC_DOCUMENT_KEY,
        cloneState(nextDocument),
      )
      root.set(CANVASCII_YDOC_LEGACY_STATE_KEY, cloneState(editorStateRef.current))
      lastSharedJsonRef.current = stableJson(canvasDocumentToEditorState(nextDocument))
      applySharedEditorState(editorStateRef.current)
    }

    root.observe(syncFromDoc)
    persistence?.once('synced', () => {
      if (!provider) {
        bootstrapIfNeeded()
      }
    })
    const handleProviderSynced = () => {
      providerSynced = true
      bootstrapIfNeeded()
    }
    provider?.on('synced', handleProviderSynced)
    provider?.awareness?.on('change', syncAwareness)
    syncAwareness()

    return () => {
      root.unobserve(syncFromDoc)
      provider?.awareness?.off('change', syncAwareness)
      provider?.off('synced', handleProviderSynced)
      provider?.destroy()
      persistence?.destroy()
      doc.destroy()
      collabStateRef.current = null
      lastCollaboratorsJsonRef.current = '[]'
      setCollaborators([])
    }
  }, [accessSummary?.canRead, applyLiveEditorState, applySharedEditorState, collabToken, currentUser?.id, documentId, isShareLinkSession])

  useEffect(() => {
    const awareness = collabStateRef.current?.provider?.awareness
    if (!awareness || !localPresence) return
    const nextPresenceJson = stableJson(localPresence)
    if (nextPresenceJson === lastPresenceJsonRef.current) return
    lastPresenceJsonRef.current = nextPresenceJson
    awareness.setLocalStateField('presence', localPresence)
  }, [localPresence])

  useEffect(() => {
    const active = collabStateRef.current
    const sourceState = (liveEditorState ?? editorState) as AppState | null
    if (!active || !sourceState) return

    const nextJson = stableJson(sourceState)
    const pendingLocalCommit = pendingLocalCommitRef.current
    const writeDecision = shouldWriteSharedState({
      hasProvider: Boolean(active.provider),
      lastSharedJson: lastSharedJsonRef.current,
      nextJson,
      pendingLocalCommitStateJson: pendingLocalCommit?.stateJson ?? null,
    })
    if (!writeDecision.shouldWrite) {
      return
    }
    const previousDocument =
      (() => {
        const currentDocument = active.root.get(CANVASCII_YDOC_DOCUMENT_KEY)
        if (!currentDocument || typeof currentDocument !== 'object' || Array.isArray(currentDocument)) {
          return null
        }

        return cloneState(currentDocument as ReturnType<typeof editorStateToCanvasDocument>)
      })()

    const projection =
      pendingLocalCommit && pendingLocalCommit.stateJson === nextJson
        ? pendingLocalCommit.commit.projection
        : projectEditorStateThroughCommands({
            previousDocument,
            editorState: sourceState,
            documentId,
            updatedAt: new Date().toISOString(),
          })
    const nextDocument = ensureProjectedDocument({
      projectedDocument: projection.document,
      editorState: sourceState,
      documentId,
    })
    const usedPendingLocalCommit = writeDecision.usedPendingLocalCommit

    if (accessSummary) {
      const authorization = filterCanvasCommandsByAccess({
        access: accessSummary,
        previousDocument,
        commands: projection.commands,
      })

      if (authorization.rejectedCommands.length > 0) {
        if (usedPendingLocalCommit) {
          pendingLocalCommitRef.current = null
        }
        const fallbackState =
          previousDocument ? canvasDocumentToEditorState(previousDocument) : cloneState(sourceState)
        const fallbackJson = stableJson(fallbackState)
        lastSharedJsonRef.current = fallbackJson
        setSharedEditorState(fallbackState)
        setLiveEditorState(fallbackState)
        onEditorStateChangeRef.current(cloneState(fallbackState))
        return
      }
    }

    if (projection.commands.length > 0) {
      applyPortalMirrorCommit({
        previousDocument,
        nextDocument,
        commands: projection.commands,
      })
    }

    if (usedPendingLocalCommit && pendingLocalCommit) {
      onAcceptedLocalCommitRef.current?.(pendingLocalCommit.commit)
      pendingLocalCommitRef.current = null
    }

    lastSharedJsonRef.current = nextJson
    active.root.set(
      CANVASCII_YDOC_DOCUMENT_KEY,
      cloneState(nextDocument),
    )
    active.root.set(CANVASCII_YDOC_LEGACY_STATE_KEY, cloneState(sourceState))
  }, [documentId, editorState, liveEditorState, accessSummary, applyPortalMirrorCommit])

  const effectiveState = useMemo(
    () => liveEditorState ?? sharedEditorState ?? editorState,
    [editorState, liveEditorState, sharedEditorState],
  )

  return (
    <AsciipEditorShell
      documentId={documentId}
      editorState={effectiveState}
      onEditorStateChange={onEditorStateChange}
      onLiveEditorStateChange={handleLiveEditorStateChange}
      onCommandBatch={handleCommandBatch}
      currentCollaboratorName={currentCollaboratorName}
      portalMirrorConfig={portalMirrorConfig}
      onPortalMirrorConfigChange={setPortalMirrorConfig}
      accessSummary={accessSummary}
      collaborators={collaborators}
      canManagePortals={canManagePortals}
      onEditorMetaChange={handleAsciipEditorMetaChange}
      onCreateFenceFromBounds={onCreateFenceFromBounds}
      onUpdateFence={onUpdateFence}
      onDeleteFence={onDeleteFence}
      onOpenFenceShare={onOpenFenceShare}
      onFenceDraftBoundsChange={onFenceDraftBoundsChange}
      canCreatePortalDocuments={canCreatePortalDocuments}
      onResolvePortalTarget={onResolvePortalTarget}
        onOpenPortalDestination={onOpenPortalDestination}
        portalTargetShapeMap={portalTargetShapeMap}
        componentDefinitionMap={componentDefinitionMap}
        portalNavigationFocus={portalNavigationFocus}
      onPortalNavigationFocusHandled={onPortalNavigationFocusHandled}
      onDismissPortalNavigationFocus={onDismissPortalNavigationFocus}
      toolbarLeading={toolbarLeading}
      toolbarFullscreen={toolbarFullscreen}
      toolbarTrailing={toolbarTrailing}
      terminalPreview={terminalPreview}
      onRequestCreateComponentFromSelection={onRequestCreateComponentFromSelection}
      showHistory={showHistory}
      focusPoint={focusPoint}
      showCollaboratorOverlays={showCollaboratorOverlays}
    />
  )
}
