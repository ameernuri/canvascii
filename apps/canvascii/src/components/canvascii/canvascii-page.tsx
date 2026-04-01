'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Blocks,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Expand,
  FileText,
  FolderOpen,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { type CanvasCommand, type CanvasCollaboratorPresence } from '@canvascii/core'
import {
  executeStructureCanvasCommand,
  parseStructureCanvasCommand,
} from '@canvascii/agent-client/structure-command-language'
import { createUniqueCanvasName } from '@canvascii/agent-client/canvas-names'
import { canvasLibraryApi, type CanvasDetail, type CanvasSummary } from '@/lib/canvas-library-api'
import { CollaborativeEditorShell } from '@/components/canvascii/collaborative-editor-shell'
import { CanvasShareDialog } from '@/components/canvascii/canvas-share-dialog'
import { useCanvasShareActions } from '@/components/canvascii/use-canvas-share-actions'
import { initAppState, type AppState, type ComponentAttribute } from '@/components/asciip-core/store/appSlice'
import type { AsciipCommittedState } from '@/components/asciip-core/store/middleware'
import { useAuth } from '@/components/AuthProvider'
import { CANVASCII_SHARE_TOKEN_QUERY_PARAM } from '@/lib/canvas-share-token'
import type { EditorInteractionMeta, EditorTerminalPreview } from '@/lib/canvascii/collaboration'
import { projectEditorStateThroughCommands } from '@/lib/canvascii/command-projection'
import { editorStateToCanvasDocument } from '@/lib/canvascii/document-bridge'
import { createComponentView, type CanvasPortalView, type PortalRect } from '@/lib/canvascii/live-portals'
import type { ShapeObject } from '@/components/asciip-core/store/diagramSlice'
import { initDiagramData } from '@/components/asciip-core/store/diagramSlice'
import { applyAgentActionToEditorState, type CanvasAgentAction } from '@/lib/canvascii/agent-edit'
import { getBoundingBoxOfAll } from '@/components/asciip-core/models/shapeInCanvas'
import { translateUnbounded } from '@/components/asciip-core/models/transformation'
import {
  buildTerminalPreview as buildCanonicalTerminalPreview,
  executeTerminalCommand as executeCanonicalTerminalCommand,
  getActivePage as getCanonicalActivePage,
  getChildPages as getCanonicalChildPages,
  getPageAncestors as getCanonicalPageAncestors,
  getTerminalCommandHelp as getCanonicalTerminalCommandHelp,
  parseCanvasToolCommand as parseCanonicalTerminalCommand,
  type ParsedTerminalCommand,
} from '@/lib/canvascii/terminal-commands'

function formatAgo(value?: string | null) {
  if (!value) return 'unknown'
  const ms = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'just now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function getInitials(value?: string | null) {
  const normalized = value?.trim()
  if (!normalized) return '??'
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
}

function toStableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function quoteCommandValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')}"`
}

function slugifyCanvasKeyPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/**
 * Creates an opaque storage key for DB persistence.
 * Users should only see canvas titles; this key just keeps records unique.
 */
function createCanvasStorageKey(title: string, prefix = 'canvas') {
  const slug = slugifyCanvasKeyPart(title) || prefix
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}-${slug}-${stamp}`
}

function getUniqueCanvasTitle(existingTitles: string[]) {
  return createUniqueCanvasName(existingTitles)
}

type StatusBarEntry = {
  id: string
  tone: 'command' | 'success' | 'error' | 'info'
  text: string
}

type CanvasSearchEntry = {
  id: string
  text: string
  row: number
  col: number
  type: string
}

type ComponentAttributeDraft = {
  id: string
  key: string
  defaultValue: string
}

function createComponentAttributeDraft(key = '', defaultValue = ''): ComponentAttributeDraft {
  return {
    id: `attr-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    key,
    defaultValue,
  }
}

function resetCreateComponentDraft(input: {
  setOpen: (open: boolean) => void
  setName: (value: string) => void
  setAttributes: (value: ComponentAttributeDraft[]) => void
  setSelectionIds: (value: string[]) => void
}) {
  input.setOpen(false)
  input.setName('')
  input.setAttributes([])
  input.setSelectionIds([])
}

function buildComponentCreateCommand(input: {
  name: string
  attributes: Array<{ key: string; defaultValue: string }>
}) {
  const trimmedName = input.name.trim()
  const attributeSuffix = input.attributes
    .map((attribute) => ({
      key: attribute.key.trim(),
      defaultValue: attribute.defaultValue,
    }))
    .filter((attribute) => attribute.key.length > 0)
    .map((attribute) => ` attr.${attribute.key}=${quoteCommandValue(attribute.defaultValue)}`)
    .join('')

  return `component.create${trimmedName ? ` name=${quoteCommandValue(trimmedName)}` : ''}${attributeSuffix}`
}

const SCRATCH_DOCUMENT_ID = '__scratch__'
const UNTITLED_CANVAS_TITLE = 'untitled-canvas'
const PORTAL_FOCUS_CANVAS_PARAM = 'portalFocusCanvas'
const PORTAL_FOCUS_TOP_PARAM = 'portalFocusTop'
const PORTAL_FOCUS_LEFT_PARAM = 'portalFocusLeft'
const PORTAL_FOCUS_WIDTH_PARAM = 'portalFocusWidth'
const PORTAL_FOCUS_HEIGHT_PARAM = 'portalFocusHeight'
const PORTAL_FOCUS_LABEL_PARAM = 'portalFocusLabel'
const PORTAL_RETURN_FILE_PARAM = 'portalReturnFile'
const PORTAL_RETURN_CANVAS_PARAM = 'portalReturnCanvas'
const PORTAL_RETURN_TOP_PARAM = 'portalReturnTop'
const PORTAL_RETURN_LEFT_PARAM = 'portalReturnLeft'
const PORTAL_RETURN_WIDTH_PARAM = 'portalReturnWidth'
const PORTAL_RETURN_HEIGHT_PARAM = 'portalReturnHeight'
const PORTAL_RETURN_LABEL_PARAM = 'portalReturnLabel'
const STATUS_BAR_ENTRY_LIMIT = 8

function isBlankAppState(state: AppState | null): boolean {
  if (!state) return true
  return toStableJson(state) === toStableJson(initAppState())
}

function parseIntQuery(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : null
}

function getPortalViewsForActiveDiagram(state: AppState | null): CanvasPortalView[] {
  if (!state) return []
  const activeDiagram = state.diagrams.find((diagram) => diagram.id === state.activeDiagramId)
  return Array.isArray(activeDiagram?.data?.portalViews) ? activeDiagram.data.portalViews : []
}

function getShapeMapForEditorState(state: AppState | null): Record<string, ShapeObject[]> {
  if (!state) return {}
  return Object.fromEntries(
    state.diagrams.map((diagram) => [diagram.id, diagram.data.shapes as ShapeObject[]]),
  )
}

function createClientCanvasId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getActiveDiagram(state: AppState) {
  return state.diagrams.find((diagram) => diagram.id === state.activeDiagramId) ?? state.diagrams[0]
}

function getChildDiagrams(state: AppState, parentCanvasId: string | null) {
  return state.diagrams.filter((diagram) => (diagram.parentCanvasId ?? null) === parentCanvasId)
}

function getDescendantDiagrams(state: AppState, parentCanvasId: string) {
  const descendants = []
  const queue = [...getChildDiagrams(state, parentCanvasId)]
  while (queue.length > 0) {
    const next = queue.shift()
    if (!next) continue
    descendants.push(next)
    queue.push(...getChildDiagrams(state, next.id))
  }
  return descendants
}

function getDiagramAncestors(state: AppState, canvasId: string) {
  const byId = new Map(state.diagrams.map((diagram) => [diagram.id, diagram]))
  const trail = []
  let cursor = byId.get(canvasId) ?? null
  while (cursor) {
    trail.unshift(cursor)
    cursor = cursor.parentCanvasId ? byId.get(cursor.parentCanvasId) ?? null : null
  }
  return trail
}

function resolveDiagramMatch(state: AppState, query: string) {
  const clean = query.trim()
  if (!clean) return null

  const numericIndex = Number.parseInt(clean, 10)
  if (Number.isFinite(numericIndex) && numericIndex >= 1 && numericIndex <= state.diagrams.length) {
    return state.diagrams[numericIndex - 1] ?? null
  }

  const lower = clean.toLowerCase()
  return (
    state.diagrams.find((diagram) => diagram.id === clean) ??
    state.diagrams.find((diagram) => diagram.name.toLowerCase() === lower) ??
    state.diagrams.find((diagram) => diagram.name.toLowerCase().includes(lower)) ??
    null
  )
}

function getDocumentScopedCanvasKey(documentId: string, canvasId: string) {
  return `${documentId}:${canvasId}`
}

function formatCanvasCommandForStatus(command: CanvasCommand) {
  switch (command.type) {
    case 'object.upsert': {
      const geometry = command.input.object.geometry
      switch (geometry.type) {
        case 'rectangle': {
          const width = geometry.bottomRight.col - geometry.topLeft.col + 1
          const height = geometry.bottomRight.row - geometry.topLeft.row + 1
          return `box.upsert top=${geometry.topLeft.row} left=${geometry.topLeft.col} width=${width} height=${height}`
        }
        case 'text': {
          const preview = geometry.lines[0]?.trim()
          return `text.upsert row=${geometry.start.row} col=${geometry.start.col}${preview ? ` text=${quoteCommandValue(preview)}` : ''}`
        }
        case 'line':
          return `line.upsert fromRow=${geometry.segment.start.row} fromCol=${geometry.segment.start.col} toRow=${geometry.segment.end.row} toCol=${geometry.segment.end.col}`
        case 'polyline': {
          const first = geometry.segments[0]
          const last = geometry.segments.at(-1)
          if (first && last) {
            return `path.upsert fromRow=${first.start.row} fromCol=${first.start.col} toRow=${last.end.row} toCol=${last.end.col}`
          }
          return 'path.upsert'
        }
        case 'group':
          return `group.upsert children=${geometry.childObjectIds.length}`
      }
    }
    case 'object.delete':
      return `object.delete id=${command.input.objectId}`
    case 'canvas.create':
      return `page.create name=${quoteCommandValue(command.input.canvas.name)}`
    case 'canvas.upsert':
      return `page.upsert name=${quoteCommandValue(command.input.canvas.name)}`
    case 'canvas.rename':
      return `page.rename id=${command.input.canvasId} name=${quoteCommandValue(command.input.name)}`
    case 'canvas.set-active':
      return `page.open target=${quoteCommandValue(command.input.canvasId)}`
    case 'canvas.delete':
      return `page.delete id=${command.input.canvasId}`
  }
}

function summarizeCommandBatch(commands: CanvasCommand[]) {
  if (commands.length === 0) return 'No commands applied.'
  const preview = commands.slice(0, 3).map(formatCanvasCommandForStatus).join(' · ')
  return commands.length > 3 ? `${preview} · +${commands.length - 3} more` : preview
}

/**
 * Component props use simple {{name}} placeholders inside source pages.
 * This helper scans selected shapes and auto-seeds attributes from those placeholders
 * so turning a selection into a component feels useful immediately.
 */
function collectComponentAttributeKeys(shapes: ShapeObject[]) {
  const keys = new Set<string>()
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g
  for (const shapeObj of shapes) {
    const textSources =
      shapeObj.shape.type === 'TEXT'
        ? shapeObj.shape.lines ?? []
        : shapeObj.shape.type === 'RECTANGLE'
          ? [shapeObj.shape.label ?? '', ...(shapeObj.shape.labelLines ?? [])]
          : shapeObj.shape.type === 'LINE' || shapeObj.shape.type === 'MULTI_SEGMENT_LINE'
            ? shapeObj.shape.labelLines ?? []
            : []
    for (const source of textSources) {
      for (const match of source.matchAll(pattern)) {
        if (match[1]) {
          keys.add(match[1])
        }
      }
    }
  }
  return [...keys]
}

function collectCanvasSearchEntries(shapes: ShapeObject[]): CanvasSearchEntry[] {
  return shapes.flatMap((shapeObj) => {
    const shape = shapeObj.shape
    if (shape.type === 'TEXT') {
      const text = shape.lines.join(' ').trim()
      return text
        ? [
            {
              id: shapeObj.id,
              text,
              row: shape.start.r,
              col: shape.start.c,
              type: 'text',
            },
          ]
        : []
    }

    if ('labelLines' in shape && Array.isArray(shape.labelLines)) {
      const parts =
        shape.type === 'RECTANGLE'
          ? [shape.label ?? '', ...shape.labelLines]
          : shape.labelLines
      const text = parts.join(' ').trim()
      if (!text) return []
      const anchor =
        shape.type === 'RECTANGLE'
          ? shape.tl
          : shape.type === 'LINE'
            ? shape.start
            : shape.segments[0]?.start

      return anchor
        ? [
            {
              id: shapeObj.id,
              text,
              row: anchor.r,
              col: anchor.c,
              type: shape.type.toLowerCase(),
            },
          ]
        : []
    }

    return []
  })
}

function removeShapeIdsFromGroups(groups: AppState['diagrams'][number]['data']['groups'], shapeIds: Set<string>) {
  return groups
    .map((group) => ({
      ...group,
      shapeIds: group.shapeIds.filter((shapeId) => !shapeIds.has(shapeId)),
    }))
    .filter((group) => group.shapeIds.length > 1)
}

function buildComponentDefinitionMap(input: {
  currentDocumentId: string
  currentState: AppState
  portalTargetFiles: Record<string, CanvasDetail>
}) {
  const entries: Array<[string, {
    name: string
    attributes: ComponentAttribute[]
    canvasSize: {
      rows: number
      cols: number
    }
  }]> = []
  for (const diagram of input.currentState.diagrams) {
    if (diagram.kind !== 'component') continue
    entries.push([
      getDocumentScopedCanvasKey(input.currentDocumentId, diagram.id),
      {
        name: diagram.name,
        attributes: diagram.componentAttributes,
        canvasSize: diagram.data.canvasSize,
      },
    ])
  }

  for (const [documentId, detail] of Object.entries(input.portalTargetFiles)) {
    const state = detail.editorState as AppState | null
    if (!state) continue
    for (const diagram of state.diagrams) {
      if (diagram.kind !== 'component') continue
      entries.push([
        getDocumentScopedCanvasKey(documentId, diagram.id),
        {
          name: diagram.name,
          attributes: diagram.componentAttributes,
          canvasSize: diagram.data.canvasSize,
        },
      ])
    }
  }

  return Object.fromEntries(entries)
}

function extractSelectionToComponent(
  state: AppState,
  selectedObjectIds: string[],
  name?: string | null,
) {
  if (selectedObjectIds.length === 0) {
    throw new Error('Select one or more objects before creating a component.')
  }

  const activePage = getActiveDiagram(state)
  const selectedIdSet = new Set(selectedObjectIds)
  const selectedShapes = activePage.data.shapes.filter((shapeObj) => selectedIdSet.has(shapeObj.id))
  const bounds = getBoundingBoxOfAll(selectedShapes.map((shapeObj) => shapeObj.shape))
  if (!bounds) {
    throw new Error('The current selection has no drawable bounds.')
  }

  const nextComponentId = createClientCanvasId()
  const normalizedShapes = selectedShapes.map((shapeObj) => ({
    ...shapeObj,
    shape: translateUnbounded(shapeObj.shape, {
      r: -bounds.top,
      c: -bounds.left,
    }),
  }))
  const componentAttributes = collectComponentAttributeKeys(selectedShapes).map((key) => ({
    key,
    defaultValue: '',
  }))
  const componentName = name?.trim() || `Component ${state.diagrams.filter((diagram) => diagram.kind === 'component').length + 1}`
  const componentView = createComponentView({
    canvasId: activePage.id,
    sourceCanvasId: nextComponentId,
    label: componentName,
    rect: {
      top: bounds.top,
      left: bounds.left,
      width: bounds.right - bounds.left + 1,
      height: bounds.bottom - bounds.top + 1,
    },
  })

  const nextComponentPage = {
    id: nextComponentId,
    name: componentName,
    parentCanvasId: activePage.id,
    kind: 'component' as const,
    sourceCanvasId: null,
    componentAttributes,
    data: initDiagramData({
      canvasSize: {
        rows: bounds.bottom - bounds.top + 1,
        cols: bounds.right - bounds.left + 1,
      },
      shapes: normalizedShapes,
      groups: activePage.data.groups.filter((group) => group.shapeIds.every((shapeId) => selectedIdSet.has(shapeId))),
      portalViews: [],
      styleMode: activePage.data.styleMode,
      globalStyle: activePage.data.globalStyle,
    }),
  }

  const nextState: AppState = {
    ...state,
    diagrams: state.diagrams.flatMap((diagram) => {
      if (diagram.id !== activePage.id) {
        return [diagram]
      }
      return [
        {
          ...diagram,
          data: {
            ...diagram.data,
            shapes: diagram.data.shapes.filter((shapeObj) => !selectedIdSet.has(shapeObj.id)),
            groups: removeShapeIdsFromGroups(diagram.data.groups, selectedIdSet),
            portalViews: [...diagram.data.portalViews, componentView],
          },
        },
        nextComponentPage,
      ]
    }),
    activeDiagramId: activePage.id,
  }

  return {
    nextState,
    componentName,
    attributeCount: componentAttributes.length,
  }
}

export function CanvasciiPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const deepLinkedCanvasId = searchParams.get('canvas')?.trim() || null
  const deepLinkedStorageKey = searchParams.get('storageKey')?.trim() || searchParams.get('path')?.trim() || null
  const activeShareToken = searchParams.get(CANVASCII_SHARE_TOKEN_QUERY_PARAM)?.trim() || null
  const { isAuthenticated, isLoading, session, signOut, user } = useAuth()

  const [rootCanvases, setRootCanvases] = useState<CanvasSummary[]>([])
  /** Canonical storage key for the currently open root canvas. */
  const [selectedStorageKey, setSelectedStorageKey] = useState<string | null>(null)
  const [selectedCanvas, setSelectedCanvas] = useState<CanvasDetail | null>(null)
  const [draftState, setDraftState] = useState<AppState | null>(() => initAppState())
  const [query, setQuery] = useState('')

  const [loadingFiles, setLoadingFiles] = useState(true)
  const [loadingFile, setLoadingFile] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autosaving, setAutosaving] = useState(false)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [creating, setCreating] = useState(false)
  const [creatingDraftFile, setCreatingDraftFile] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [createComponentOpen, setCreateComponentOpen] = useState(false)
  const [createComponentName, setCreateComponentName] = useState('')
  const [createComponentAttributes, setCreateComponentAttributes] = useState<ComponentAttributeDraft[]>([])
  const [createComponentSelectionIds, setCreateComponentSelectionIds] = useState<string[]>([])
  const lastNonEmptySelectionRef = useRef<string[]>([])
  const [canvasRenameTargetId, setCanvasRenameTargetId] = useState<string | null>(null)
  const [canvasRenameDraft, setCanvasRenameDraft] = useState('')
  const [canvasDeleteTargetId, setCanvasDeleteTargetId] = useState<string | null>(null)
  const [titleEditOpen, setTitleEditOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandDraft, setCommandDraft] = useState('')

  // Backward-compatible local aliases while the page shell migrates off the old names.
  const files = rootCanvases
  const setFiles = setRootCanvases
  const selectedFile = selectedCanvas
  const setSelectedFile = setSelectedCanvas
  const selectedPath = selectedStorageKey
  const setSelectedPath = setSelectedStorageKey
  const [commandError, setCommandError] = useState<string | null>(null)
  const [commandResult, setCommandResult] = useState<string | null>(null)
  const [commandOutput, setCommandOutput] = useState<string | null>(null)
  const [runningCommand, setRunningCommand] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareDialogTab, setShareDialogTab] = useState<'canvas' | 'portal'>('canvas')
  const [shareDialogPortalId, setShareDialogPortalId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState('')
  const [editorMeta, setEditorMeta] = useState<EditorInteractionMeta | null>(null)
  const [liveCollaborators, setLiveCollaborators] = useState<CanvasCollaboratorPresence[]>([])
  const [portalTargetFiles, setPortalTargetFiles] = useState<Record<string, CanvasDetail>>({})
  const [expandedCanvasTree, setExpandedCanvasTree] = useState<Record<string, boolean>>({})
  const [statusEntries, setStatusEntries] = useState<StatusBarEntry[]>([])
  const [showStatusBar, setShowStatusBar] = useState(true)
  const [showHistory, setShowHistory] = useState(true)
  const [showCollaboratorOverlays, setShowCollaboratorOverlays] = useState(true)
  const [canvasFocusPoint, setCanvasFocusPoint] = useState<{
    row: number
    col: number
    key: string
  } | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(null)
  const lastAutoSaveKeyRef = useRef<string | null>(null)
  const lastSavedStateKeyRef = useRef<string | null>(null)
  const latestDraftStateRef = useRef<AppState | null>(draftState)
  const lastEditorMetaKeyRef = useRef<string | null>(null)
  const lastSelectionStatusKeyRef = useRef<string | null>(null)
  const lastLiveStatusStateRef = useRef<AppState | null>(null)
  const pendingOpenFileIdRef = useRef<string | null>(null)
  const pendingOpenFilePathRef = useRef<string | null>(null)
  const failedOpenFileIdRef = useRef<string | null>(null)
  const failedOpenFilePathRef = useRef<string | null>(null)
  const pendingFileCommandsRef = useRef<{ fileId: string; commands: CanvasCommand[]; stateJson: string } | null>(null)
  const pendingScratchCommandsRef = useRef<{ commands: CanvasCommand[]; stateJson: string } | null>(null)
  const scratchSeedCommandsRef = useRef<{ commands: CanvasCommand[]; stateJson: string } | null>(null)

  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)

  const pushStatusEntry = useCallback((entry: Omit<StatusBarEntry, 'id'>) => {
    setStatusEntries((current) => {
      const nextEntry: StatusBarEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...entry,
      }
      return [nextEntry, ...current].slice(0, STATUS_BAR_ENTRY_LIMIT)
    })
  }, [])

  const savedStateJson = useMemo(() => toStableJson(selectedFile?.editorState ?? {}), [selectedFile?.editorState])
  const draftStateJson = useMemo(() => toStableJson(draftState ?? {}), [draftState])
  const isLiveSharedSession = Boolean(activeShareToken)
  const isDirty = !isLiveSharedSession && Boolean(selectedPath && selectedFile && draftState) && savedStateJson !== draftStateJson
  const isScratchCanvas = !selectedFile
  const hasScratchChanges = useMemo(() => !isBlankAppState(draftState), [draftState])

  const visibleFiles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return files
    return files.filter((file) =>
      `${file.storageKey} ${file.name} ${file.title} ${file.ownerEmail ?? ''}`.toLowerCase().includes(needle),
    )
  }, [files, query])
  const suggestedCanvasTitle = useMemo(
    () => getUniqueCanvasTitle(files.map((file) => file.title || file.name)),
    [files],
  )

  const canEditSelected = Boolean(selectedFile?.accessSummary.canEditSomewhere)
  const canManageSharing = Boolean(selectedFile && selectedFile.ownerUserId === user?.id)
  const viewerLabel = useMemo(() => {
    const name = user?.name?.trim()
    if (name) return name
    const email = user?.email?.trim()
    if (!email) return null
    return email.split('@')[0] ?? email
  }, [user?.email, user?.name])

  const viewerEmail = useMemo(() => user?.email?.trim() || null, [user?.email])
  const visibleTerminalCommands = useMemo(
    () => getCanonicalTerminalCommandHelp(commandDraft),
    [commandDraft],
  )
  const statusCursor = useMemo(() => {
    const cell = editorMeta?.textCursorCell ?? editorMeta?.hoveredCell ?? null
    if (!cell) return null
    return {
      x: cell.col,
      y: cell.row,
    }
  }, [editorMeta?.hoveredCell, editorMeta?.textCursorCell])

  const handleJumpToCanvasPoint = useCallback((input: { row: number; col: number; label?: string | null }) => {
    setCanvasFocusPoint({
      row: input.row,
      col: input.col,
      key: `${Date.now()}:${input.row}:${input.col}`,
    })
    pushStatusEntry({
      tone: 'info',
      text: input.label
        ? `jump row=${input.row} col=${input.col} · ${input.label}`
        : `jump row=${input.row} col=${input.col}`,
    })
  }, [pushStatusEntry])

  useEffect(() => {
    if ((editorMeta?.selectedObjectIds?.length ?? 0) > 0) {
      lastNonEmptySelectionRef.current = [...(editorMeta?.selectedObjectIds ?? [])]
    }
  }, [editorMeta?.selectedObjectIds])

  const commandState = useMemo(
    () => (draftState ?? (selectedFile?.editorState as AppState | null) ?? initAppState()),
    [draftState, selectedFile?.editorState],
  )
  const parsedTerminalCommand = useMemo<ParsedTerminalCommand | null>(() => {
    const value = commandDraft.trim()
    if (!value) return null
    try {
      return parseCanonicalTerminalCommand(
        value,
        editorMeta?.selectedObjectIds?.[0] ?? null,
      )
    } catch {
      return null
    }
  }, [commandDraft, editorMeta?.selectedObjectIds])
  const commandDraftHint = useMemo(() => {
    const value = commandDraft.trim()
    if (!value || parsedTerminalCommand) return null
    try {
      parseCanonicalTerminalCommand(value, editorMeta?.selectedObjectIds?.[0] ?? null)
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Keep typing to complete the command.'
    }
  }, [commandDraft, editorMeta?.selectedObjectIds, parsedTerminalCommand])
  const commandPreview = useMemo(
    () => buildCanonicalTerminalPreview(commandDraft, commandState, editorMeta?.selectedObjectIds?.[0] ?? null),
    [commandDraft, commandState, editorMeta?.selectedObjectIds],
  )
  const activeDiagram = useMemo(
    () => getCanonicalActivePage(commandState),
    [commandState],
  )
  const activePageTrail = useMemo(
    () => getCanonicalPageAncestors(commandState, activeDiagram.id),
    [activeDiagram.id, commandState],
  )
  const childPages = useMemo(
    () => getCanonicalChildPages(commandState, activeDiagram.id),
    [activeDiagram.id, commandState],
  )
  const canvasSearchEntries = useMemo(
    () => collectCanvasSearchEntries(activeDiagram.data.shapes as ShapeObject[]),
    [activeDiagram.data.shapes],
  )
  const matchingCanvasSearchEntries = useMemo(() => {
    const needle = searchDraft.trim().toLowerCase()
    if (!needle) return []
    return canvasSearchEntries
      .filter((entry) => entry.text.toLowerCase().includes(needle))
      .slice(0, 16)
  }, [canvasSearchEntries, searchDraft])
  const rootPages = useMemo(
    () => getCanonicalChildPages(commandState, null),
    [commandState],
  )
  const visibleCollaboratorsInHeader = useMemo(() => liveCollaborators, [liveCollaborators])
  const activelyEditingCollaborators = useMemo(
    () =>
      visibleCollaboratorsInHeader.filter(
        (collaborator) =>
          collaborator.status === 'editing' &&
          (collaborator.cursor?.canvasId === commandState.activeDiagramId ||
            collaborator.viewport?.canvasId === commandState.activeDiagramId ||
            collaborator.draft?.canvasId === commandState.activeDiagramId),
      ),
    [commandState.activeDiagramId, visibleCollaboratorsInHeader],
  )
  const compactHeaderCollaborators = useMemo(
    () => activelyEditingCollaborators.filter((collaborator) => collaborator.userId !== user?.id),
    [activelyEditingCollaborators, user?.id],
  )
  const canvasRenameTarget = useMemo(
    () => commandState.diagrams.find((diagram) => diagram.id === canvasRenameTargetId) ?? null,
    [canvasRenameTargetId, commandState.diagrams],
  )
  const canvasDeleteTarget = useMemo(
    () => commandState.diagrams.find((diagram) => diagram.id === canvasDeleteTargetId) ?? null,
    [canvasDeleteTargetId, commandState.diagrams],
  )
  const canvasDeleteDescendantCount = useMemo(
    () => (canvasDeleteTarget ? getDescendantDiagrams(commandState, canvasDeleteTarget.id).length : 0),
    [canvasDeleteTarget, commandState],
  )

  const currentRouteHref = useMemo(() => {
    const queryString = searchParams.toString()
    return queryString ? `${pathname}?${queryString}` : pathname
  }, [pathname, searchParams])

  const activePortalViews = useMemo(
    () => getPortalViewsForActiveDiagram(draftState),
    [draftState],
  )

  const portalTargetShapeMap = useMemo(() => {
    const fromSelected = getShapeMapForEditorState(draftState)
    const fromTargets = Object.fromEntries(
      Object.entries(portalTargetFiles).flatMap(([documentId, detail]) => {
        const state = (detail.editorState as AppState | null) ?? null
        return Object.entries(getShapeMapForEditorState(state)).map(([canvasId, shapes]) => [
          `${documentId}:${canvasId}`,
          shapes,
        ])
      }),
    )

    return {
      ...Object.fromEntries(
        Object.entries(fromSelected).map(([canvasId, shapes]) => [`${selectedFile?.id ?? SCRATCH_DOCUMENT_ID}:${canvasId}`, shapes]),
      ),
      ...fromTargets,
    }
  }, [draftState, portalTargetFiles, selectedFile?.id])

  const componentDefinitionMap = useMemo(
    () =>
      buildComponentDefinitionMap({
        currentDocumentId: selectedFile?.id ?? SCRATCH_DOCUMENT_ID,
        currentState: commandState,
        portalTargetFiles,
      }),
    [commandState, portalTargetFiles, selectedFile?.id],
  )

  const portalNavigationFocus = useMemo(() => {
    const top = parseIntQuery(searchParams.get(PORTAL_FOCUS_TOP_PARAM))
    const left = parseIntQuery(searchParams.get(PORTAL_FOCUS_LEFT_PARAM))
    const width = parseIntQuery(searchParams.get(PORTAL_FOCUS_WIDTH_PARAM))
    const height = parseIntQuery(searchParams.get(PORTAL_FOCUS_HEIGHT_PARAM))
    const canvasId = searchParams.get(PORTAL_FOCUS_CANVAS_PARAM)?.trim() || null
    if (top == null || left == null || width == null || height == null || !canvasId) {
      return null
    }
    return {
      canvasId,
      rect: { top, left, width, height },
      label: searchParams.get(PORTAL_FOCUS_LABEL_PARAM)?.trim() || null,
    }
  }, [searchParams])

  const portalReturnInfo = useMemo(() => {
    const fileId = searchParams.get(PORTAL_RETURN_FILE_PARAM)?.trim() || null
    const canvasId = searchParams.get(PORTAL_RETURN_CANVAS_PARAM)?.trim() || null
    const top = parseIntQuery(searchParams.get(PORTAL_RETURN_TOP_PARAM))
    const left = parseIntQuery(searchParams.get(PORTAL_RETURN_LEFT_PARAM))
    const width = parseIntQuery(searchParams.get(PORTAL_RETURN_WIDTH_PARAM))
    const height = parseIntQuery(searchParams.get(PORTAL_RETURN_HEIGHT_PARAM))
    if (!fileId || !canvasId || top == null || left == null || width == null || height == null) {
      return null
    }
    return {
      fileId,
      canvasId,
      rect: { top, left, width, height },
      label: searchParams.get(PORTAL_RETURN_LABEL_PARAM)?.trim() || null,
    }
  }, [searchParams])

  const upsertFileSummaryFromDetail = useCallback((detail: CanvasDetail) => {
    setFiles((current) => {
      const summary: CanvasSummary = { ...detail }
      const index = current.findIndex((item) => item.id === detail.id)
      if (index === -1) return [summary, ...current]
      const next = [...current]
      next[index] = summary
      return next
    })
  }, [])

  const updateUrlCanvasParam = useCallback(
    (nextCanvasId: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (nextCanvasId) params.set('canvas', nextCanvasId)
      else params.delete('canvas')
      params.delete('path')
      const queryString = params.toString()
      const nextHref = queryString ? `${pathname}?${queryString}` : pathname
      const currentHref = searchParams.toString() ? `${pathname}?${searchParams.toString()}` : pathname
      if (nextHref === currentHref) return
      router.replace(nextHref, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  useEffect(() => {
    latestDraftStateRef.current = draftState
  }, [draftState])

  useEffect(() => {
    lastLiveStatusStateRef.current = draftState
  }, [draftState, selectedFile?.id])

  useEffect(() => {
    setTitleDraft(selectedFile ? selectedFile.title || selectedFile.name : UNTITLED_CANVAS_TITLE)
    setTitleEditOpen(false)
  }, [selectedFile?.id, selectedFile?.title, selectedFile?.name])

  useEffect(() => {
    if (!titleEditOpen) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [titleEditOpen])

  useEffect(() => {
    if (!commandOpen) return
    commandInputRef.current?.focus()
  }, [commandOpen])

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      const tag = element.tagName
      return (
        element.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      )
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const primary = event.metaKey || event.ctrlKey
      if (primary && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((current) => !current)
      } else if (
        event.key === '/' &&
        !primary &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault()
        setCommandOpen(true)
      } else if (event.key === 'Escape') {
        setCommandOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    pendingFileCommandsRef.current = null
  }, [selectedFile?.etag, selectedFile?.id])

  useEffect(() => {
    if (!isScratchCanvas) {
      pendingScratchCommandsRef.current = null
      scratchSeedCommandsRef.current = null
      return
    }

    if (!draftState || scratchSeedCommandsRef.current) {
      return
    }

    scratchSeedCommandsRef.current = {
      commands: projectEditorStateThroughCommands({
        previousDocument: null,
        editorState: draftState,
        documentId: SCRATCH_DOCUMENT_ID,
        documentName: UNTITLED_CANVAS_TITLE,
        updatedAt: new Date().toISOString(),
      }).commands,
      stateJson: toStableJson(draftState),
    }
  }, [draftState, isScratchCanvas])

  const handleEditorMetaChange = useCallback((meta: EditorInteractionMeta) => {
    const nextKey = toStableJson(meta)
    if (nextKey === lastEditorMetaKeyRef.current) return
    lastEditorMetaKeyRef.current = nextKey
    const nextSelectionKey = meta.selectedObjectIds.join(',')
    if (nextSelectionKey !== lastSelectionStatusKeyRef.current) {
      lastSelectionStatusKeyRef.current = nextSelectionKey
      if (meta.selectedObjectIds.length > 0) {
        pushStatusEntry({
          tone: 'info',
          text: `select ${meta.selectedObjectIds.length === 1 ? meta.selectedObjectIds[0] : `${meta.selectedObjectIds.length} objects`}`,
        })
      }
    }
    setEditorMeta(meta)
  }, [pushStatusEntry])

  const {
    handleShareAction,
    handleCreatePortalFromBounds,
    handleUpdatePortal,
    handleDeletePortal,
  } = useCanvasShareActions({
    selectedFile,
    draftState,
    canManageSharing,
    upsertFileSummaryFromDetail,
    setSelectedFile,
    setDraftState,
    setNotice,
  })

  const handleAcceptedLocalCommit = useCallback((commit: AsciipCommittedState) => {
    if (commit.projection.commands.length === 0) {
      return
    }

    pushStatusEntry({
      tone: 'command',
      text: summarizeCommandBatch(commit.projection.commands),
    })

    const stateJson = toStableJson(commit.state)

    if (!selectedFile?.id) {
      const existing = pendingScratchCommandsRef.current
      pendingScratchCommandsRef.current = {
        commands: existing ? [...existing.commands, ...commit.projection.commands] : [...commit.projection.commands],
        stateJson,
      }
      return
    }

    const existing = pendingFileCommandsRef.current
    pendingFileCommandsRef.current = {
      fileId: selectedFile.id,
      commands: existing?.fileId === selectedFile.id ? [...existing.commands, ...commit.projection.commands] : [...commit.projection.commands],
      stateJson,
    }
  }, [pushStatusEntry, selectedFile?.id])

  const handleLiveEditorStateChange = useCallback((next: AppState) => {
    lastLiveStatusStateRef.current = next
  }, [])

  const getQueuedCommandsForState = useCallback((input: { editorState: AppState; fileId?: string | null }) => {
    const stateJson = toStableJson(input.editorState)

    if (input.fileId) {
      const pending = pendingFileCommandsRef.current
      if (pending?.fileId === input.fileId && pending.stateJson === stateJson && pending.commands.length > 0) {
        return [...pending.commands]
      }

      return undefined
    }

    const seed = scratchSeedCommandsRef.current
    const pending = pendingScratchCommandsRef.current

    if (pending?.stateJson === stateJson && seed?.commands.length) {
      return [...seed.commands, ...pending.commands]
    }

    if (!pending && seed?.stateJson === stateJson && seed.commands.length > 0) {
      return [...seed.commands]
    }

    return undefined
  }, [])

  const handleResolvePortalTarget = useCallback(async (input: {
    mode: 'new-canvas' | 'same-canvas'
    rect: PortalRect
    activeCanvasId: string
  }) => {
    if (input.mode === 'same-canvas' || !isAuthenticated) {
      return {
        documentId: selectedFile?.id ?? SCRATCH_DOCUMENT_ID,
        canvasId: input.activeCanvasId,
        top: input.rect.top,
        left: input.rect.left,
        label: null,
      }
    }

    const createState = initAppState()
    const created = await canvasLibraryApi.createCanvas({
      storageKey: createCanvasStorageKey('portal-destination', 'portal'),
      title: 'Portal destination',
      editorState: createState as unknown as Record<string, unknown>,
      commands: getQueuedCommandsForState({
        editorState: createState,
        fileId: null,
      }),
    })

    upsertFileSummaryFromDetail(created)
    setFiles((current) => {
      if (current.some((file) => file.id === created.id)) return current
      return [{ ...created }, ...current]
    })

    return {
      documentId: created.id,
      canvasId: ((created.editorState as AppState | undefined)?.activeDiagramId ?? input.activeCanvasId),
      top: 0,
      left: 0,
      label: created.title || created.name,
    }
  }, [getQueuedCommandsForState, isAuthenticated, selectedFile, upsertFileSummaryFromDetail])

  const handleOpenPortalDestination = useCallback((input: {
    portalId: string
    label: string
    sourceDocumentId: string | null
    sourceCanvasId: string
    sourceRect: PortalRect
    target: {
      documentId: string | null
      canvasId: string
      top: number
      left: number
      width: number
      height: number
    }
  }) => {
    const params = new URLSearchParams(searchParams.toString())
    const targetDocumentId = input.target.documentId ?? selectedFile?.id ?? null
    if (targetDocumentId) {
      params.set('canvas', targetDocumentId)
    } else {
      params.delete('canvas')
    }
    params.set(PORTAL_FOCUS_CANVAS_PARAM, input.target.canvasId)
    params.set(PORTAL_FOCUS_TOP_PARAM, String(input.target.top))
    params.set(PORTAL_FOCUS_LEFT_PARAM, String(input.target.left))
    params.set(PORTAL_FOCUS_WIDTH_PARAM, String(input.target.width))
    params.set(PORTAL_FOCUS_HEIGHT_PARAM, String(input.target.height))
    params.set(PORTAL_FOCUS_LABEL_PARAM, input.label)

    if (input.sourceDocumentId) {
      params.set(PORTAL_RETURN_FILE_PARAM, input.sourceDocumentId)
      params.set(PORTAL_RETURN_CANVAS_PARAM, input.sourceCanvasId)
      params.set(PORTAL_RETURN_TOP_PARAM, String(input.sourceRect.top))
      params.set(PORTAL_RETURN_LEFT_PARAM, String(input.sourceRect.left))
      params.set(PORTAL_RETURN_WIDTH_PARAM, String(input.sourceRect.width))
      params.set(PORTAL_RETURN_HEIGHT_PARAM, String(input.sourceRect.height))
      params.set(PORTAL_RETURN_LABEL_PARAM, input.label)
    }

    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams, selectedFile?.id])

  const handlePortalNavigationFocusHandled = useCallback(() => {
  }, [])

  const handleDismissPortalNavigationFocus = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete(PORTAL_FOCUS_CANVAS_PARAM)
    params.delete(PORTAL_FOCUS_TOP_PARAM)
    params.delete(PORTAL_FOCUS_LEFT_PARAM)
    params.delete(PORTAL_FOCUS_WIDTH_PARAM)
    params.delete(PORTAL_FOCUS_HEIGHT_PARAM)
    params.delete(PORTAL_FOCUS_LABEL_PARAM)
    const nextQuery = params.toString()
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])

  async function loadFiles(background = false) {
    if (!isAuthenticated) {
      setFiles([])
      setLoadingFiles(false)
      setRefreshing(false)
      return
    }
    if (background) setRefreshing(true)
    else setLoadingFiles(true)

    try {
      const next = await canvasLibraryApi.listCanvases({ limit: 1000 })
      setFiles(next.canvases)

      if (!activeShareToken && selectedFile?.id && !next.canvases.some((canvas) => canvas.id === selectedFile.id)) {
        setSelectedPath(null)
        setSelectedFile(null)
        setDraftState(initAppState())
        updateUrlCanvasParam(null)
      }
      if (!background) setError(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load canvases.'
      if (background) {
        setNotice({ tone: 'error', message })
      } else {
        setError(message)
      }
    } finally {
      setLoadingFiles(false)
      setRefreshing(false)
    }
  }

  async function openFileById(fileId: string, allowDiscardDirty = false) {
    if (isDirty && selectedFile?.id !== fileId && !allowDiscardDirty) {
      const flushed = await flushPendingChangesBeforeCanvasNavigation()
      if (!flushed) {
        const proceed = window.confirm('Autosave could not finish. Discard your changes and open another canvas?')
        if (!proceed) return
      }
    }
    if (pendingOpenFileIdRef.current === fileId) return

    pendingOpenFileIdRef.current = fileId
    pendingOpenFilePathRef.current = null
    setLoadingFile(true)
    setDraftState(null)
    setNotice(null)
    try {
      const detail = await canvasLibraryApi.getCanvas({ id: fileId })
      failedOpenFileIdRef.current = null
      failedOpenFilePathRef.current = null
      setSelectedPath(detail.storageKey)
      setSelectedFile(detail)
      setDraftState((detail.editorState as AppState) ?? initAppState())
      setIsLibraryOpen(false)
      updateUrlCanvasParam(detail.id)
      setError(null)
    } catch (cause) {
      failedOpenFileIdRef.current = fileId
      failedOpenFilePathRef.current = pendingOpenFilePathRef.current
      setNotice({
        tone: 'error',
        message: cause instanceof Error ? cause.message : 'Failed to open canvas.',
      })
    } finally {
      if (pendingOpenFileIdRef.current === fileId) {
        pendingOpenFileIdRef.current = null
      }
      setLoadingFile(false)
    }
  }

  async function persistEditorState(options: {
    mode: 'manual' | 'auto'
    id: string
    baseEtag: string
    editorState: AppState
  }): Promise<CanvasDetail | null> {
    if (isLiveSharedSession) {
      return null
    }

    const markBusy = options.mode === 'manual' ? setSaving : setAutosaving
    markBusy(true)
    try {
      const queuedCommands = getQueuedCommandsForState({
        editorState: options.editorState,
        fileId: options.id,
      })
      const updated = await canvasLibraryApi.updateCanvas({
        id: options.id,
        editorState: options.editorState as unknown as Record<string, unknown>,
        commands: queuedCommands,
        ifMatchEtag: options.baseEtag,
        changeType: options.mode === 'auto' ? 'autosave' : 'commit',
      })
      pendingFileCommandsRef.current = null
      setSelectedFile(updated)
      upsertFileSummaryFromDetail(updated)
      const persistedKey = `${options.id}:${toStableJson(options.editorState)}`
      lastSavedStateKeyRef.current = persistedKey
      if (options.mode === 'manual') {
        setNotice({ tone: 'success', message: `Saved ${updated.title || updated.name}.` })
      }
      return updated
    } catch (cause) {
      setNotice({
        tone: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : options.mode === 'manual'
              ? 'Failed to save.'
              : 'Autosave failed. Please save manually after reloading.',
      })
      return null
    } finally {
      markBusy(false)
    }
  }

  async function flushPendingChangesBeforeCanvasNavigation(): Promise<boolean> {
    const latestState = latestDraftStateRef.current
    if (isLiveSharedSession || !latestState) return true

    if (!selectedFile) {
      if (isBlankAppState(latestState)) return true
      const created = await ensureDraftFileForScratch(latestState)
      return Boolean(created)
    }

    if (!canEditSelected) return false
    if (savedStateJson === toStableJson(latestState)) return true

    const saved = await persistEditorState({
      mode: 'auto',
      id: selectedFile.id,
      baseEtag: selectedFile.etag,
      editorState: latestState,
    })
    return Boolean(saved)
  }

  async function handleCreate() {
    const requestedTitle = newFileName.trim() || suggestedCanvasTitle
    setCreating(true)
    setNotice(null)
    try {
      const createState = draftState ?? initAppState()
      const created = await canvasLibraryApi.createCanvas({
        storageKey: createCanvasStorageKey(requestedTitle),
        title: requestedTitle,
        editorState: createState as unknown as Record<string, unknown>,
        commands: getQueuedCommandsForState({
          editorState: createState,
          fileId: null,
        }),
      })
      pendingScratchCommandsRef.current = null
      scratchSeedCommandsRef.current = null
      setCreateOpen(false)
      setNewFileName('')
      setNotice({ tone: 'success', message: `Created ${created.title || created.name}.` })
      await loadFiles(true)
      await openFileById(created.id, true)
    } catch (cause) {
      setNotice({
        tone: 'error',
        message: cause instanceof Error ? cause.message : 'Failed to create canvas.',
      })
    } finally {
      setCreating(false)
    }
  }

  async function ensureDraftFileForScratch(nextState?: AppState): Promise<CanvasDetail | null> {
    if (!isAuthenticated) return null
    if (selectedFile || creating || creatingDraftFile) return selectedFile

    const candidateState = nextState ?? latestDraftStateRef.current
    if (!candidateState || isBlankAppState(candidateState)) return null

    setCreatingDraftFile(true)
    try {
      const generatedTitle = suggestedCanvasTitle
      const created = await canvasLibraryApi.createCanvas({
        storageKey: createCanvasStorageKey(generatedTitle, 'draft'),
        title: generatedTitle,
        editorState: candidateState as unknown as Record<string, unknown>,
        commands: getQueuedCommandsForState({
          editorState: candidateState,
          fileId: null,
        }),
      })
      setSelectedPath(created.storageKey)
      setSelectedFile(created)
      setDraftState((current) => {
        if (current && !isBlankAppState(current)) return current
        return candidateState
      })
      lastSavedStateKeyRef.current = `${created.id}:${toStableJson(candidateState)}`
      pendingScratchCommandsRef.current = null
      scratchSeedCommandsRef.current = null
      upsertFileSummaryFromDetail(created)
      updateUrlCanvasParam(created.id)
      return created
    } catch (cause) {
      setNotice({
        tone: 'error',
        message: cause instanceof Error ? cause.message : 'Failed to create autosave draft.',
      })
      return null
    } finally {
      setCreatingDraftFile(false)
    }
  }

  async function handleTitleRename() {
    if (!selectedFile) return
    const cleanTitle = titleDraft.trim()
    if (!cleanTitle) {
      setTitleDraft(selectedFile.title || selectedFile.name)
      setTitleEditOpen(false)
      return
    }

    setRenaming(true)
    setNotice(null)
    try {
      const updated = await canvasLibraryApi.renameCanvas({
        id: selectedFile.id,
        title: cleanTitle,
        ifMatchEtag: selectedFile.etag,
      })
      setSelectedPath(updated.storageKey)
      setSelectedFile(updated)
      upsertFileSummaryFromDetail(updated)
      setTitleDraft(updated.title || updated.name)
      setTitleEditOpen(false)
    } catch (cause) {
      setNotice({
        tone: 'error',
        message: cause instanceof Error ? cause.message : 'Failed to rename canvas title.',
      })
      setTitleDraft(selectedFile.title || selectedFile.name)
    } finally {
      setRenaming(false)
    }
  }

  async function handleToolCommandSubmit() {
    setRunningCommand(true)
    setCommandError(null)
    setCommandResult(null)
    setCommandOutput(null)
    try {
      const parsedCommand =
        parsedTerminalCommand ??
        parseCanonicalTerminalCommand(
          commandDraft,
          editorMeta?.selectedObjectIds?.[0] ?? null,
        )
      const { nextState, message, output } = executeCanonicalTerminalCommand(
        commandState,
        parsedCommand.command,
        editorMeta?.selectedObjectIds ?? [],
      )
      const syntaxNote =
        parsedCommand.syntaxStyle === 'legacy'
          ? ` Normalized to ${parsedCommand.canonicalInput}.`
          : ''

      setDraftState(nextState)
      setCommandResult(`${message}${syntaxNote}`)
      setCommandOutput(output ?? null)
      pushStatusEntry({
        tone: 'success',
        text: `cmd ${parsedCommand.canonicalInput}`,
      })

      if (selectedFile && !isLiveSharedSession && toStableJson(nextState) !== toStableJson(commandState)) {
        await persistEditorState({
          mode: 'manual',
          id: selectedFile.id,
          baseEtag: selectedFile.etag,
          editorState: nextState,
        })
      } else if (!selectedFile) {
        setNotice({
          tone: 'info',
          message: 'Applied locally to the scratch canvas. Save or create a root canvas to persist it.',
        })
      }

      setCommandDraft('')
      window.requestAnimationFrame(() => {
        commandInputRef.current?.focus()
      })
    } catch (cause) {
      pushStatusEntry({
        tone: 'error',
        text: cause instanceof Error ? cause.message : 'Failed to run command.',
      })
      setCommandError(cause instanceof Error ? cause.message : 'Failed to run command.')
    } finally {
      setRunningCommand(false)
    }
  }

  function applyStructureCommand(commandText: string, options?: { selectedObjectIds?: string[] }) {
    const parsed = parseStructureCanvasCommand(commandText)
    const { nextState, message } = executeStructureCanvasCommand(commandState, parsed.command, {
      selectedObjectIds: options?.selectedObjectIds ?? editorMeta?.selectedObjectIds ?? [],
    })
    setDraftState(nextState)
    setCommandError(null)
    setCommandResult(
      parsed.syntaxStyle === 'legacy'
        ? `${message} Normalized to ${parsed.canonicalInput}.`
        : message,
    )
    setCommandOutput(null)
    pushStatusEntry({
      tone: 'command',
      text: `ui ${parsed.canonicalInput}`,
    })
    return nextState
  }

  async function toggleFullscreen() {
    const host = editorHostRef.current
    if (!host) return
    if (document.fullscreenElement === host) {
      await document.exitFullscreen()
      return
    }
    await host.requestFullscreen()
  }

  function handleOpenPage(canvasId: string) {
    applyStructureCommand(`page.open target=${quoteCommandValue(canvasId)}`)
  }

  function handleCreateCanvas(parentCanvasId: string | null) {
    const generatedName = getUniqueCanvasTitle(commandState.diagrams.map((diagram) => diagram.name))
    applyStructureCommand(
      parentCanvasId === null
        ? `page.new name=${quoteCommandValue(generatedName)} parent="root"`
        : `page.new name=${quoteCommandValue(generatedName)} parent=${quoteCommandValue(parentCanvasId)}`,
    )
    setIsLibraryOpen(true)
  }

  function handleCreateChildPage() {
    handleCreateCanvas(activeDiagram.id)
  }

  function handleRequestCanvasRename(canvasId: string) {
    const target = commandState.diagrams.find((diagram) => diagram.id === canvasId)
    if (!target) return
    setCanvasRenameTargetId(canvasId)
    setCanvasRenameDraft(target.name)
  }

  function handleConfirmCanvasRename() {
    if (!canvasRenameTargetId || !canvasRenameDraft.trim()) return
    applyStructureCommand(
      `page.rename target=${quoteCommandValue(canvasRenameTargetId)} name=${quoteCommandValue(canvasRenameDraft.trim())}`,
    )
    setCanvasRenameTargetId(null)
    setCanvasRenameDraft('')
  }

  function handleDuplicateCanvas(canvasId: string) {
    applyStructureCommand(`page.duplicate target=${quoteCommandValue(canvasId)}`)
    setIsLibraryOpen(true)
  }

  function handleRequestCanvasDelete(canvasId: string) {
    setCanvasDeleteTargetId(canvasId)
  }

  function handleConfirmCanvasDelete() {
    if (!canvasDeleteTargetId) return
    applyStructureCommand(`page.delete target=${quoteCommandValue(canvasDeleteTargetId)}`)
    setCanvasDeleteTargetId(null)
    setIsLibraryOpen(true)
  }

  function handleSetPageKind(canvasId: string, kind: 'page' | 'component') {
    const baseState =
      canvasId === commandState.activeDiagramId
        ? commandState
        : executeStructureCanvasCommand(
            commandState,
            parseStructureCanvasCommand(`page.open target=${quoteCommandValue(canvasId)}`).command,
            { selectedObjectIds: editorMeta?.selectedObjectIds ?? [] },
          ).nextState

    const parsed = parseStructureCanvasCommand(kind === 'component' ? 'component.mark' : 'component.unmark')
    const { nextState, message } = executeStructureCanvasCommand(baseState, parsed.command, {
      selectedObjectIds: editorMeta?.selectedObjectIds ?? [],
    })
    setDraftState(nextState)
    setCommandError(null)
    setCommandResult(message)
    pushStatusEntry({
      tone: 'command',
      text: `ui ${parsed.canonicalInput}`,
    })
  }

  function handleCreateComponentFromSelection(shapeIds?: string[]) {
    const selectedObjectIds =
      shapeIds && shapeIds.length > 0
        ? shapeIds
        : editorMeta?.selectedObjectIds && editorMeta.selectedObjectIds.length > 0
          ? editorMeta.selectedObjectIds
          : lastNonEmptySelectionRef.current.length > 0
            ? lastNonEmptySelectionRef.current
            : activeDiagram.data.shapes.length === 1
              ? [activeDiagram.data.shapes[0].id]
              : []
    if (selectedObjectIds.length === 0) {
      setCommandError('Select one or more objects before creating a component.')
      return
    }

    const selectedIdSet = new Set(selectedObjectIds)
    const selectedShapes = activeDiagram.data.shapes.filter((shapeObj) => selectedIdSet.has(shapeObj.id))
    const inferredAttributes = collectComponentAttributeKeys(selectedShapes).map((key) =>
      createComponentAttributeDraft(key, ''),
    )
    setCreateComponentName('')
    setCreateComponentAttributes(inferredAttributes.length > 0 ? inferredAttributes : [createComponentAttributeDraft()])
    setCreateComponentSelectionIds(selectedObjectIds)
    setCreateComponentOpen(true)
  }

  function handleUpdateCreateComponentAttribute(id: string, changes: Partial<Omit<ComponentAttributeDraft, 'id'>>) {
    setCreateComponentAttributes((current) =>
      current.map((attribute) => (attribute.id === id ? { ...attribute, ...changes } : attribute)),
    )
  }

  function handleRemoveCreateComponentAttribute(id: string) {
    setCreateComponentAttributes((current) => {
      if (current.length <= 1) {
        return [createComponentAttributeDraft()]
      }
      return current.filter((attribute) => attribute.id !== id)
    })
  }

  function handleAddCreateComponentAttribute() {
    setCreateComponentAttributes((current) => [...current, createComponentAttributeDraft()])
  }

  function handleConfirmCreateComponentFromSelection() {
    const selectedObjectIds = createComponentSelectionIds.length > 0 ? createComponentSelectionIds : (editorMeta?.selectedObjectIds ?? [])
    if (selectedObjectIds.length === 0) {
      setCommandError('Select one or more objects before creating a component.')
      return
    }

    try {
      applyStructureCommand(
        buildComponentCreateCommand({
          name: createComponentName,
          attributes: createComponentAttributes,
        }),
        {
          selectedObjectIds,
        },
      )
      setCreateComponentOpen(false)
      setCreateComponentName('')
      setCreateComponentAttributes([])
      setCreateComponentSelectionIds([])
      setIsLibraryOpen(true)
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : 'Failed to create component from the current selection.')
    }
  }

  function handleInsertComponentInstance(sourceCanvasId: string) {
    const sourcePage = commandState.diagrams.find((diagram) => diagram.id === sourceCanvasId)
    const targetPage = activeDiagram
    if (!sourcePage || sourcePage.kind !== 'component') {
      return
    }
    const existingInstances = targetPage.data.portalViews.filter((view) => view.viewType === 'component').length
    applyStructureCommand(
      `component.use source=${quoteCommandValue(sourcePage.id)} top=${4 + existingInstances * 2} left=${4 + existingInstances * 4}`,
    )
  }

  function handleResetScratch() {
    const blankStateKey = toStableJson(initAppState())
    if (draftStateJson !== blankStateKey) {
      const proceed = window.confirm('Clear the scratch canvas and start over?')
      if (!proceed) return
    }
    pendingScratchCommandsRef.current = null
    scratchSeedCommandsRef.current = null
    setSelectedPath(null)
    setSelectedFile(null)
    setDraftState(initAppState())
    updateUrlCanvasParam(null)
    setNotice({ tone: 'info', message: 'Started a new scratch canvas.' })
  }

  async function handleSignOut() {
    if (isScratchCanvas && hasScratchChanges && draftState) {
      await ensureDraftFileForScratch(draftState)
    } else if (!isLiveSharedSession && selectedPath && selectedFile && draftState && savedStateJson !== draftStateJson) {
      await persistEditorState({
        mode: 'auto',
        id: selectedFile.id,
        baseEtag: selectedFile.etag,
        editorState: draftState,
      })
    }

    await signOut()
    pendingFileCommandsRef.current = null
    pendingScratchCommandsRef.current = null
    scratchSeedCommandsRef.current = null
    setSelectedPath(null)
    setSelectedFile(null)
    setDraftState(initAppState())
    setNotice({ tone: 'info', message: 'Signed out.' })
  }

  useEffect(() => {
    if (!isLoading) {
      void loadFiles()
    }
  }, [activeShareToken, isAuthenticated, isLoading])

  useEffect(() => {
    if (!isAuthenticated || activeShareToken) return
    const handle = window.setInterval(() => {
      void loadFiles(true)
    }, 20000)
    return () => window.clearInterval(handle)
  }, [activeShareToken, isAuthenticated, selectedPath])

  useEffect(() => {
    if (failedOpenFileIdRef.current && failedOpenFileIdRef.current !== deepLinkedCanvasId) {
      failedOpenFileIdRef.current = null
    }
    if (failedOpenFilePathRef.current && failedOpenFilePathRef.current !== deepLinkedStorageKey) {
      failedOpenFilePathRef.current = null
    }
    if (!isAuthenticated && !activeShareToken) return
    if (loadingFile) return
    if (deepLinkedCanvasId) {
      if (
        selectedFile?.id === deepLinkedCanvasId ||
        pendingOpenFileIdRef.current === deepLinkedCanvasId ||
        failedOpenFileIdRef.current === deepLinkedCanvasId
      ) return
      setSelectedPath(null)
      setSelectedFile(null)
      setDraftState(null)
      void openFileById(deepLinkedCanvasId, true)
      return
    }
    if (!deepLinkedStorageKey) return
    if (
      selectedPath === deepLinkedStorageKey ||
      pendingOpenFilePathRef.current === deepLinkedStorageKey ||
      failedOpenFilePathRef.current === deepLinkedStorageKey
    ) return
    if (!files.some((canvas) => canvas.storageKey === deepLinkedStorageKey)) return
    const match = files.find((canvas) => canvas.storageKey === deepLinkedStorageKey)
    if (match) {
      pendingOpenFilePathRef.current = deepLinkedStorageKey
      setSelectedPath(null)
      setSelectedFile(null)
      setDraftState(null)
      void openFileById(match.id, true)
    }
  }, [activeShareToken, deepLinkedCanvasId, deepLinkedStorageKey, files, isAuthenticated, loadingFile, selectedFile?.id, selectedPath])

  useEffect(() => {
    if (!loadingFile) {
      pendingOpenFilePathRef.current = null
    }
  }, [loadingFile])

  useEffect(() => {
    const targetDocumentIds = Array.from(
      new Set(
        activePortalViews
          .map((portalView) => portalView.target.documentId)
          .filter((documentId): documentId is string => Boolean(documentId && documentId !== selectedFile?.id)),
      ),
    )

    if (targetDocumentIds.length === 0) {
      setPortalTargetFiles({})
      return
    }

    let cancelled = false
    void Promise.all(
      targetDocumentIds.map(async (documentId) => {
        const detail = await canvasLibraryApi.getCanvas({ id: documentId })
        return [documentId, detail] as const
      }),
    )
      .then((entries) => {
        if (cancelled) return
        setPortalTargetFiles(Object.fromEntries(entries))
      })
      .catch(() => {
        if (cancelled) return
      })

    return () => {
      cancelled = true
    }
  }, [activePortalViews, selectedFile?.id])

  useEffect(() => {
    if ((!isAuthenticated && !activeShareToken) || !autoSaveEnabled || isLiveSharedSession) return
    if (!selectedPath || !selectedFile || !draftState) return
    if (loadingFile) return
    if (!canEditSelected) return
    if (savedStateJson === draftStateJson) return
    if (saving || autosaving) return

    const autoSaveKey = `${selectedFile.id}:${selectedFile.etag}:${draftStateJson}`
    if (lastAutoSaveKeyRef.current === autoSaveKey) return
    if (lastSavedStateKeyRef.current === `${selectedFile.id}:${draftStateJson}`) return

    const timer = window.setTimeout(() => {
      lastAutoSaveKeyRef.current = autoSaveKey
      void persistEditorState({
        mode: 'auto',
        id: selectedFile.id,
        baseEtag: selectedFile.etag,
        editorState: draftState,
      })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [activeShareToken, autoSaveEnabled, autosaving, canEditSelected, draftState, draftStateJson, isAuthenticated, isLiveSharedSession, loadingFile, savedStateJson, saving, selectedFile, selectedPath])

  useEffect(() => {
    if (!isAuthenticated || !autoSaveEnabled) return
    if (!isScratchCanvas || !hasScratchChanges) return
    if (loadingFile) return
    if (creatingDraftFile || creating || saving || autosaving) return

    const timer = window.setTimeout(() => {
      void ensureDraftFileForScratch(latestDraftStateRef.current ?? undefined)
    }, 500)

    return () => window.clearTimeout(timer)
  }, [
    autoSaveEnabled,
    autosaving,
    creating,
    creatingDraftFile,
    hasScratchChanges,
    isAuthenticated,
    isScratchCanvas,
    loadingFile,
    saving,
  ])

  useEffect(() => {
    if ((!isAuthenticated && !activeShareToken) || !autoSaveEnabled || isLiveSharedSession) return
    if (!draftState) return
    if (loadingFile) return

    const flushAutosave = () => {
      if (isScratchCanvas) {
        if (!hasScratchChanges || creatingDraftFile || creating) return
        void ensureDraftFileForScratch(draftState)
        return
      }
      if (!selectedPath || !selectedFile) return
      if (!canEditSelected) return
      if (savedStateJson === draftStateJson) return
      if (saving || autosaving) return
      void persistEditorState({
        mode: 'auto',
        id: selectedFile.id,
        baseEtag: selectedFile.etag,
        editorState: draftState,
      })
    }

    const handlePageHide = () => {
      flushAutosave()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAutosave()
      }
    }

    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    autoSaveEnabled,
    autosaving,
    creating,
    creatingDraftFile,
    draftState,
    draftStateJson,
    hasScratchChanges,
    activeShareToken,
    isAuthenticated,
    isLiveSharedSession,
    isScratchCanvas,
    loadingFile,
    savedStateJson,
    saving,
    canEditSelected,
    selectedFile,
    selectedPath,
  ])

  useEffect(() => {
    const handle = () => {
      setIsFullscreen(document.fullscreenElement === editorHostRef.current)
    }
    document.addEventListener('fullscreenchange', handle)
    return () => document.removeEventListener('fullscreenchange', handle)
  }, [])

  const toolbarLeading = (
    <>
      {portalReturnInfo ? (
        <Button
          size="sm"
          variant="ghost"
          className="border border-white/10 text-slate-100 hover:bg-slate-800 hover:text-slate-100"
          onClick={() => {
            const params = new URLSearchParams(searchParams.toString())
            params.set('canvas', portalReturnInfo.fileId)
            params.set(PORTAL_FOCUS_CANVAS_PARAM, portalReturnInfo.canvasId)
            params.set(PORTAL_FOCUS_TOP_PARAM, String(portalReturnInfo.rect.top))
            params.set(PORTAL_FOCUS_LEFT_PARAM, String(portalReturnInfo.rect.left))
            params.set(PORTAL_FOCUS_WIDTH_PARAM, String(portalReturnInfo.rect.width))
            params.set(PORTAL_FOCUS_HEIGHT_PARAM, String(portalReturnInfo.rect.height))
            if (portalReturnInfo.label) {
              params.set(PORTAL_FOCUS_LABEL_PARAM, portalReturnInfo.label)
            } else {
              params.delete(PORTAL_FOCUS_LABEL_PARAM)
            }
            params.delete(PORTAL_RETURN_FILE_PARAM)
            params.delete(PORTAL_RETURN_CANVAS_PARAM)
            params.delete(PORTAL_RETURN_TOP_PARAM)
            params.delete(PORTAL_RETURN_LEFT_PARAM)
            params.delete(PORTAL_RETURN_WIDTH_PARAM)
            params.delete(PORTAL_RETURN_HEIGHT_PARAM)
            params.delete(PORTAL_RETURN_LABEL_PARAM)
            router.replace(`${pathname}?${params.toString()}`, { scroll: false })
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      ) : null}
      {isAuthenticated ? (
        <Sheet open={isLibraryOpen} onOpenChange={setIsLibraryOpen}>
          <SheetTrigger
            render={
              <Button
                aria-label="Open canvas library"
                size="icon"
                variant="ghost"
                className="text-slate-100 hover:bg-slate-800 hover:text-slate-100"
              />
            }
          >
            <PanelLeft className="h-4 w-4" />
          </SheetTrigger>
          <SheetContent side="left" className="w-[24rem] border-white/10 bg-[#0b0f15] p-0 text-white sm:max-w-[24rem]">
            <div className="flex h-full flex-col">
              <SheetHeader className="border-b border-white/10 px-5 py-5 text-left">
                <SheetTitle className="text-white">Canvases</SheetTitle>
                <SheetDescription className="text-white/60">
                  {visibleFiles.length} root canvas{visibleFiles.length === 1 ? '' : 'es'}
                </SheetDescription>
              </SheetHeader>
              <div className="border-b border-white/10 px-5 py-4">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  className="h-11 rounded-none border-white/20 bg-transparent text-white placeholder:text-white/35"
                />
              </div>
              <div className="border-b border-white/10 px-5 py-4">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 w-full rounded-none border-white/20 bg-transparent text-white hover:bg-white/5 hover:text-white"
                  onClick={() => handleCreateCanvas(null)}
                >
                  + New Canvas
                </Button>
              </div>
              <div className="flex-1 overflow-auto px-3 py-4">
                {loadingFiles ? (
                  <p className="px-2 py-4 text-sm text-white/60">Loading canvases...</p>
                ) : visibleFiles.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-white/60">No root canvases yet.</p>
                ) : (
                  <div className="space-y-2">
                    {visibleFiles.map((file) => {
                      const active = file.id === selectedFile?.id
                      const fileIsExpanded = active
                      return (
                        <div key={file.id} className="space-y-2">
                          <button
                            type="button"
                            className={cn(
                              'flex w-full items-center justify-between rounded-none border border-white/15 px-4 py-3 text-left transition-colors',
                              active ? 'bg-white/8 text-white' : 'bg-transparent text-white/90 hover:bg-white/5',
                            )}
                            onClick={() => void openFileById(file.id)}
                          >
                            <span className="truncate text-sm">{file.title || file.name}</span>
                            {fileIsExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-white/60" /> : <ChevronRight className="h-4 w-4 shrink-0 text-white/60" />}
                          </button>
                          {fileIsExpanded ? (
                            <div className="space-y-2">
                              {rootPages.map((rootPage) => {
                                const renderNode = (pageId: string, depth = 0): React.ReactNode => {
                                  const page = commandState.diagrams.find((entry) => entry.id === pageId)
                                  if (!page) return null
                                  const children = getChildDiagrams(commandState, page.id)
                                  const expanded = expandedCanvasTree[page.id] ?? activePageTrail.some((entry) => entry.id === page.id)
                                  return (
                                    <div key={page.id} className="space-y-2">
                                      <button
                                        type="button"
                                        className={cn(
                                          'flex w-full items-center justify-between rounded-none border border-white/12 px-4 py-3 text-left text-sm transition-colors',
                                          page.id === commandState.activeDiagramId
                                            ? 'bg-white/10 text-white'
                                            : 'bg-transparent text-white/85 hover:bg-white/5',
                                        )}
                                        style={{ marginLeft: `${depth * 16}px`, width: `calc(100% - ${depth * 16}px)` }}
                                        onClick={() => handleOpenPage(page.id)}
                                      >
                                        <span className="truncate">{page.name}</span>
                                        {children.length > 0 ? (
                                          <span
                                            className="shrink-0 text-white/60"
                                            onClick={(event) => {
                                              event.preventDefault()
                                              event.stopPropagation()
                                              setExpandedCanvasTree((current) => ({
                                                ...current,
                                                [page.id]: !expanded,
                                              }))
                                            }}
                                          >
                                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                          </span>
                                        ) : (
                                          <span className="h-4 w-4 shrink-0" />
                                        )}
                                      </button>
                                      {children.length > 0 && expanded ? children.map((child) => renderNode(child.id, depth + 1)) : null}
                                    </div>
                                  )
                                }
                                return renderNode(rootPage.id)
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-col">
          {selectedFile && titleEditOpen ? (
            <Input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void handleTitleRename()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleTitleRename()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setTitleDraft(selectedFile.title || selectedFile.name)
                  setTitleEditOpen(false)
                }
              }}
              className="h-8 max-w-[20rem] border-white/10 bg-white/4 px-2 text-sm font-medium text-slate-100"
            />
          ) : (
            <button
              type="button"
              className="truncate text-left text-sm font-medium text-slate-100 outline-hidden hover:text-white"
              onClick={() => {
                if (!selectedFile) return
                setTitleDraft(selectedFile.title || selectedFile.name)
                setTitleEditOpen(true)
              }}
            >
              {selectedFile ? selectedFile.title || selectedFile.name : UNTITLED_CANVAS_TITLE}
            </button>
          )}
          <div className="flex min-w-0 items-center gap-1 text-[11px] text-white/45">
            {activePageTrail.map((page, index) => (
              <div key={page.id} className="flex min-w-0 items-center gap-1">
                {index > 0 ? <span>/</span> : null}
                <button
                  type="button"
                  className={cn(
                    'max-w-[10rem] truncate hover:text-white',
                    page.id === commandState.activeDiagramId ? 'text-white/80' : 'text-white/45',
                  )}
                  onClick={() => handleOpenPage(page.id)}
                >
                  {page.name}
                </button>
              </div>
            ))}
            {childPages.length > 0 ? (
              <span className="truncate text-white/30">· {childPages.length} child canvas{childPages.length === 1 ? '' : 'es'}</span>
            ) : null}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 border-white/10 bg-white/4 text-slate-100 hover:bg-slate-800 hover:text-slate-100"
              />
            }
          >
            New Canvas
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={handleCreateChildPage}>
              Create child canvas
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => handleCreateCanvas(null)}>
              Create root canvas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )

  const toolbarFullscreen = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-slate-100 hover:bg-slate-800 hover:text-slate-100"
              onClick={() => void toggleFullscreen()}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              <Expand className="h-4 w-4" />
            </Button>
          }
        />
        <TooltipContent>{isFullscreen ? 'Exit full screen' : 'Full screen'}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )

  const toolbarTrailing = isAuthenticated ? (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-slate-100 hover:bg-slate-800 hover:text-slate-100"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        Search
      </Button>
      {selectedFile ? (
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-100 hover:bg-slate-800 hover:text-slate-100"
          onClick={() => {
            setShareDialogTab('canvas')
            setShareDialogPortalId(null)
            setShareOpen(true)
          }}
        >
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
      ) : null}
      {compactHeaderCollaborators.length > 0 ? (
        <AvatarGroup className="hidden items-center sm:flex">
          {compactHeaderCollaborators.slice(0, 3).map((collaborator) => (
            <TooltipProvider key={collaborator.sessionId || collaborator.actorId || collaborator.userId}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Avatar
                      size="sm"
                      className="border border-white/10 bg-slate-900/90 shadow-sm"
                    >
                      <AvatarFallback className="bg-slate-800 text-[10px] font-semibold text-slate-100">
                        {getInitials(collaborator.name ?? 'Collaborator')}
                      </AvatarFallback>
                    </Avatar>
                  }
                />
                <TooltipContent>
                  {collaborator.name ?? 'Collaborator'}
                  {collaborator.status ? ` · ${collaborator.status}` : ''}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
          {compactHeaderCollaborators.length > 3 ? (
            <AvatarGroupCount className="size-6 bg-slate-800 text-[10px] font-semibold text-slate-100">
              +{compactHeaderCollaborators.length - 3}
            </AvatarGroupCount>
          ) : null}
        </AvatarGroup>
      ) : null}
      {viewerLabel ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="hidden min-w-0 rounded-full border border-white/10 bg-white/4 px-2.5 text-slate-100 hover:bg-slate-800 sm:inline-flex"
              >
                <Avatar size="sm" className="border border-white/10 bg-slate-900/90">
                  <AvatarFallback className="bg-slate-800 text-[10px] font-semibold text-slate-100">
                    {getInitials(viewerLabel)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm font-medium text-slate-100">{viewerLabel}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <div className="flex items-center gap-3 border-b px-3 py-3">
              <Avatar className="border bg-muted">
                <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
                  {getInitials(viewerLabel)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{viewerLabel}</div>
                {viewerEmail ? <div className="truncate text-xs text-muted-foreground">{viewerEmail}</div> : null}
              </div>
            </div>
            <DropdownMenuCheckboxItem
              checked={showCollaboratorOverlays}
              onCheckedChange={(checked) => setShowCollaboratorOverlays(Boolean(checked))}
            >
              Show live collaborator cursors
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSignOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  ) : (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="text-slate-100 hover:bg-slate-800 hover:text-slate-100"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        Search
      </Button>
      <Link
        href={`/sign-in?next=${encodeURIComponent(currentRouteHref)}`}
        className={cn(buttonVariants({ size: 'sm' }), 'bg-slate-50 text-slate-950 hover:bg-white')}
      >
        Sign in to save
      </Link>
      <Link
        href={`/sign-in?next=${encodeURIComponent(currentRouteHref)}`}
        className={cn(
          buttonVariants({ size: 'sm', variant: 'ghost' }),
          'text-slate-100 hover:bg-slate-800 hover:text-slate-100'
        )}
      >
        <FolderOpen className="mr-2 h-4 w-4" />
        Open canvases
      </Link>
    </>
  )

  return (
    <div className="h-svh w-full overflow-hidden bg-[#070a0f] text-white">
      <div ref={editorHostRef} className="h-full w-full overflow-hidden">
        {draftState ? (
          <CollaborativeEditorShell
            documentId={selectedFile?.documentId ?? SCRATCH_DOCUMENT_ID}
            editorState={draftState as unknown as Record<string, unknown>}
            sourceStateVersion={selectedFile ? `${selectedFile.id}:${selectedFile.etag}:${selectedFile.revision}` : 'scratch'}
            onEditorStateChange={(next) => setDraftState(next)}
            onLiveEditorStateChange={handleLiveEditorStateChange}
            onAcceptedLocalCommit={handleAcceptedLocalCommit}
            collabToken={activeShareToken ? `share:${activeShareToken}` : session?.id ? 'better-auth-session' : null}
            currentUser={user}
            currentCollaboratorName={viewerLabel ?? viewerEmail ?? 'You'}
            accessSummary={selectedFile?.accessSummary ?? null}
            canManagePortals={canManageSharing}
            onEditorMetaChange={handleEditorMetaChange}
            onCollaboratorsChange={setLiveCollaborators}
            onCreateFenceFromBounds={canManageSharing ? handleCreatePortalFromBounds : undefined}
            onUpdateFence={canManageSharing ? ((input) => handleUpdatePortal({
              portalId: input.fenceId,
              top: input.top,
              left: input.left,
              width: input.width,
              height: input.height,
            })) : undefined}
            onDeleteFence={canManageSharing ? handleDeletePortal : undefined}
            onOpenFenceShare={canManageSharing ? ((portalId) => {
              setShareDialogTab('portal')
              setShareDialogPortalId(portalId)
              setShareOpen(true)
            }) : undefined}
            canCreatePortalDocuments={Boolean(isAuthenticated && selectedFile && !activeShareToken)}
            onResolvePortalTarget={handleResolvePortalTarget}
            onOpenPortalDestination={handleOpenPortalDestination}
            portalTargetShapeMap={portalTargetShapeMap}
            componentDefinitionMap={componentDefinitionMap}
            portalNavigationFocus={portalNavigationFocus}
            onPortalNavigationFocusHandled={handlePortalNavigationFocusHandled}
            onDismissPortalNavigationFocus={handleDismissPortalNavigationFocus}
            toolbarLeading={toolbarLeading}
            toolbarFullscreen={toolbarFullscreen}
            toolbarTrailing={toolbarTrailing}
            terminalPreview={commandOpen ? commandPreview : null}
            onRequestCreateComponentFromSelection={handleCreateComponentFromSelection}
            showHistory={showHistory}
            focusPoint={canvasFocusPoint}
            showCollaboratorOverlays={showCollaboratorOverlays}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/70">Preparing canvas...</div>
        )}
      </div>

      {commandOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-14 z-50 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-4xl border border-white/10 bg-slate-950/96 shadow-[0_24px_80px_rgba(2,6,23,0.72)]">
            <div className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-white/45">
              Agent Tools Terminal
            </div>
            <form
              className="border-b border-white/10"
              onSubmit={(event) => {
                event.preventDefault()
                void handleToolCommandSubmit()
              }}
            >
              <Input
                ref={commandInputRef}
                value={commandDraft}
                onChange={(event) => {
                  setCommandDraft(event.target.value)
                  setCommandError(null)
                }}
                placeholder='box.create top=5 left=100 width=50 height=20 title="Header" body="Body"'
                className="h-11 border-0 bg-transparent px-3 font-mono text-sm text-slate-100 placeholder:text-white/28 focus-visible:ring-0"
              />
            </form>
            <div className="space-y-2 px-3 py-2 text-[11px] text-white/55">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="border border-white/10 px-2 py-1 text-white/60">
                  Root canvas: {selectedFile ? selectedFile.title || selectedFile.name : 'Scratch'}
                </span>
                <span className="border border-white/10 px-2 py-1 text-white/60">
                  Current child: {activeDiagram?.name ?? 'Unknown'}
                </span>
                <span className="border border-white/10 px-2 py-1 text-white/60">
                  Nested canvases: {commandState.diagrams.length}
                </span>
                <span className="border border-white/10 px-2 py-1 text-white/45">
                  Child canvas = nested canvas inside this root canvas
                </span>
              </div>
              {commandState.diagrams.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {commandState.diagrams.map((diagram, index) => (
                    <button
                      key={diagram.id}
                      type="button"
                      className={cn(
                        "border px-2 py-1 text-left text-[11px] transition",
                        diagram.id === commandState.activeDiagramId
                          ? "border-sky-400/50 bg-sky-400/10 text-sky-100"
                          : "border-white/10 text-white/60 hover:border-white/20 hover:text-white",
                      )}
                      onClick={() => {
                        setCommandDraft(`page.open target="${diagram.name}"`)
                        setCommandError(null)
                        setCommandResult(`Ready to open page “${diagram.name}”.`)
                        window.requestAnimationFrame(() => {
                          commandInputRef.current?.focus()
                        })
                      }}
                    >
                      {index + 1}. {diagram.name}
                    </button>
                  ))}
                </div>
              ) : null}
              {commandPreview ? (
                <div className="border border-sky-400/20 bg-sky-400/5 px-2 py-1 text-sky-100">
                  {commandPreview.label}
                </div>
              ) : (
                <div className="border border-white/10 px-2 py-1 text-white/45">
                  Type a command to see a live preview and scroll target.
                </div>
              )}
              {parsedTerminalCommand ? (
                <div className="space-y-1 border border-white/10 bg-white/[0.03] px-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                      {parsedTerminalCommand.syntaxStyle === 'canonical' ? 'canonical' : 'legacy alias'}
                    </span>
                    <span className="text-white/70">{parsedTerminalCommand.definition.description}</span>
                  </div>
                  <div className="font-mono text-[11px] text-white/80">
                    {parsedTerminalCommand.canonicalInput}
                  </div>
                </div>
              ) : commandDraft.trim() ? (
                <div className="border border-white/10 bg-white/[0.03] px-2 py-2 text-white/45">
                  {commandDraftHint ?? 'Keep typing. The terminal will normalize to the canonical command before execution.'}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 font-mono">
                {visibleTerminalCommands.map((command) => (
                  <button
                    key={command.name}
                    type="button"
                    className="border border-white/10 px-2 py-1 text-left text-[11px] text-white/60 transition hover:border-white/20 hover:text-white"
                    onClick={() => {
                      setCommandDraft(command.canonicalUsage)
                      setCommandError(null)
                      window.requestAnimationFrame(() => {
                        commandInputRef.current?.focus()
                        commandInputRef.current?.setSelectionRange(
                          command.canonicalUsage.length,
                          command.canonicalUsage.length,
                        )
                      })
                    }}
                    title={command.description}
                  >
                    <span>{command.canonicalUsage}</span>
                    {command.aliases?.[0] ? (
                      <span className="ml-2 text-[10px] text-white/35">alias: {command.aliases[0]}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              {commandError ? <div className="text-rose-400">{commandError}</div> : null}
              {commandResult ? <div className="text-emerald-300">{commandResult}</div> : null}
              {commandOutput ? (
                <pre className="max-h-64 overflow-auto border border-white/10 bg-black/25 p-3 font-mono text-[11px] leading-5 text-white/75 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {commandOutput}
                </pre>
              ) : null}
              {runningCommand ? <div className="text-sky-300">Running command…</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showStatusBar ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/96 shadow-[0_-10px_32px_rgba(2,6,23,0.45)]">
        <div className="flex min-h-10 items-center gap-3 px-3 py-2 text-[11px]">
          <div className="pointer-events-auto flex shrink-0 items-center gap-2 border-r border-white/10 pr-3 font-mono text-white/70">
            <span className="border border-white/10 px-2 py-1 text-white/45">status</span>
            <span className="text-white/55">
              {statusCursor ? `x ${statusCursor.x}, y ${statusCursor.y}` : 'x -, y -'}
            </span>
            <span className="text-white/35">tool {editorMeta?.activeTool ?? 'SELECT'}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 border border-white/10 px-2 text-[10px] text-white/55 hover:bg-slate-900 hover:text-white"
              onClick={() => setShowHistory((current) => !current)}
            >
              {showHistory ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
              History
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 border border-white/10 px-2 text-[10px] text-white/55 hover:bg-slate-900 hover:text-white"
              onClick={() => setShowStatusBar(false)}
            >
              <EyeOff className="mr-1 h-3 w-3" />
              Feed
            </Button>
          </div>
          <div className="pointer-events-auto no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
            {statusEntries.length > 0 ? (
              statusEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'border px-2 py-1 font-mono transition',
                    entry.tone === 'error'
                      ? 'border-rose-400/20 bg-rose-400/8 text-rose-200'
                      : entry.tone === 'success'
                        ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-200'
                        : entry.tone === 'info'
                          ? 'border-white/10 bg-white/[0.03] text-white/60'
                          : 'border-sky-400/20 bg-sky-400/8 text-sky-100',
                  )}
                >
                  {entry.text}
                </div>
              ))
            ) : (
              <div className="border border-white/10 px-2 py-1 font-mono text-white/40">
                UI command feed is idle.
              </div>
            )}
          </div>
        </div>
      </div>
      ) : (
        <div className="pointer-events-none fixed bottom-3 right-3 z-40">
          <div className="pointer-events-auto flex items-center gap-2 border border-white/10 bg-slate-950/96 px-2 py-1.5 shadow-[0_10px_30px_rgba(2,6,23,0.45)]">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 border border-white/10 px-2 text-[10px] text-white/60 hover:bg-slate-900 hover:text-white"
              onClick={() => setShowStatusBar(true)}
            >
              <Eye className="mr-1 h-3 w-3" />
              Show feed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 border border-white/10 px-2 text-[10px] text-white/60 hover:bg-slate-900 hover:text-white"
              onClick={() => setShowHistory((current) => !current)}
            >
              {showHistory ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
              History
            </Button>
          </div>
        </div>
      )}

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Search canvas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search text on the current canvas"
              autoFocus
            />
            {searchDraft.trim().length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-3 text-sm text-white/45">
                Type to search text in the current canvas.
              </div>
            ) : matchingCanvasSearchEntries.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-3 text-sm text-white/45">
                No matching text on this canvas.
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-auto">
                {matchingCanvasSearchEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-white/10 px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/[0.03]"
                    onClick={() => {
                      handleJumpToCanvasPoint({
                        row: entry.row,
                        col: entry.col,
                        label: `${entry.type} · ${entry.text}`,
                      })
                      setSearchOpen(false)
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white">{entry.text}</span>
                      <span className="block text-xs text-white/45">
                        {entry.type} at {entry.row}, {entry.col}
                      </span>
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-300">
                      Jump
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create canvas</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="canvascii-name">Canvas title</Label>
            <Input
              id="canvascii-name"
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              placeholder={suggestedCanvasTitle}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {createComponentOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35">
          <div className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="text-base font-medium text-white">Create component</h2>
                <p className="mt-1 text-xs text-white/50">
                  Extract the current selection into a reusable canvas component.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  resetCreateComponentDraft({
                    setOpen: setCreateComponentOpen,
                    setName: setCreateComponentName,
                    setAttributes: setCreateComponentAttributes,
                    setSelectionIds: setCreateComponentSelectionIds,
                  })
                }
                aria-label="Close create component"
              >
                <X />
              </Button>
            </div>
            <div className="space-y-4 px-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="canvascii-component-name">Component name</Label>
                <Input
                  id="canvascii-component-name"
                  value={createComponentName}
                  onChange={(event) => setCreateComponentName(event.target.value)}
                  placeholder="Button"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Attributes</Label>
                  <Button type="button" size="sm" variant="outline" onClick={handleAddCreateComponentAttribute}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add attribute
                  </Button>
                </div>
                <div className="space-y-2">
                  {createComponentAttributes.map((attribute) => (
                    <div key={attribute.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                      <Input
                        value={attribute.key}
                        onChange={(event) =>
                          handleUpdateCreateComponentAttribute(attribute.id, { key: event.target.value })
                        }
                        placeholder="label"
                      />
                      <Input
                        value={attribute.defaultValue}
                        onChange={(event) =>
                          handleUpdateCreateComponentAttribute(attribute.id, { defaultValue: event.target.value })
                        }
                        placeholder="Save"
                      />
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => handleRemoveCreateComponentAttribute(attribute.id)}
                        aria-label="Remove attribute"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-white/50">
                  These compile to the same <code>component.create</code> command agents use, with <code>attr.*</code> defaults.
                  Matching default values in the extracted selection are turned into tokens automatically.
                </p>
                {createComponentAttributes.some((attribute) => attribute.key.trim().length > 0) ? (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/60">
                    Place attributes inside the component source with tokens like{" "}
                    {createComponentAttributes
                      .map((attribute) => attribute.key.trim())
                      .filter((key) => key.length > 0)
                      .map((key, index) => (
                        <span key={key}>
                          {index > 0 ? ", " : ""}
                          <code className="rounded bg-black/30 px-1 py-0.5 text-white">{`{{${key}}}`}</code>
                        </span>
                      ))}
                    . You can edit the component source after creation and those tokens will render from instance props.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
              <Button
                variant="outline"
                onClick={() =>
                  resetCreateComponentDraft({
                    setOpen: setCreateComponentOpen,
                    setName: setCreateComponentName,
                    setAttributes: setCreateComponentAttributes,
                    setSelectionIds: setCreateComponentSelectionIds,
                  })
                }
              >
                Cancel
              </Button>
              <Button onClick={handleConfirmCreateComponentFromSelection}>
                Create component
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={canvasRenameTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setCanvasRenameTargetId(null)
            setCanvasRenameDraft('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Canvas</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="canvascii-canvas-rename">Canvas name</Label>
            <Input
              id="canvascii-canvas-rename"
              value={canvasRenameDraft}
              onChange={(event) => setCanvasRenameDraft(event.target.value)}
              placeholder="Hero section"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCanvasRenameTargetId(null)
                setCanvasRenameDraft('')
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmCanvasRename} disabled={!canvasRenameDraft.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={canvasDeleteTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setCanvasDeleteTargetId(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Canvas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-white/70">
            <p>
              Delete <span className="text-white">{canvasDeleteTarget?.name ?? 'this canvas'}</span>?
            </p>
            {canvasDeleteDescendantCount > 0 ? (
              <p className="text-white/55">
                This will also delete {canvasDeleteDescendantCount} nested canvas{canvasDeleteDescendantCount === 1 ? '' : 'es'}.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCanvasDeleteTargetId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmCanvasDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CanvasShareDialog
        open={shareOpen}
        onOpenChange={(open) => {
          setShareOpen(open)
          if (!open) {
            setShareDialogPortalId(null)
          }
        }}
        file={selectedFile}
        canManage={canManageSharing}
        defaultTab={shareDialogTab}
        initialPortalId={shareDialogPortalId}
        onApplyAction={async (action) => {
          await handleShareAction(action as unknown as Record<string, unknown>)
        }}
      />
    </div>
  )
}
