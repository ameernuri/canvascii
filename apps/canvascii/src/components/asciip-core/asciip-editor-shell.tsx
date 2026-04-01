'use client'

import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Provider } from 'react-redux'
import App from './components/App'
import { appActions, initAppState, type AppState } from './store/appSlice'
import {
  diagramActions,
  type DiagramData,
  type DiagramState,
} from './store/diagramSlice'
import { createAsciipStore } from './store/store'
import { defaultStyle } from './models/style'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AsciipCommittedState } from './store/middleware'
import type { EditorCollaborationProps, EditorTerminalPreview } from '@/lib/canvascii/collaboration'

function mergeLiveDiagramState(nextAppState: AppState, nextDiagramState: {
  canvasSize: AppState['diagrams'][number]['data']['canvasSize']
  shapes: AppState['diagrams'][number]['data']['shapes']
  groups: AppState['diagrams'][number]['data']['groups']
  portalViews: AppState['diagrams'][number]['data']['portalViews']
  styleMode: AppState['diagrams'][number]['data']['styleMode']
  globalStyle: AppState['diagrams'][number]['data']['globalStyle']
}): AppState {
  return {
    ...nextAppState,
    diagrams: nextAppState.diagrams.map((diagram) =>
      diagram.id === nextAppState.activeDiagramId
        ? {
            ...diagram,
            data: {
              ...diagram.data,
              canvasSize: nextDiagramState.canvasSize,
              shapes: nextDiagramState.shapes,
              groups: nextDiagramState.groups,
              portalViews: nextDiagramState.portalViews,
              styleMode: nextDiagramState.styleMode,
              globalStyle: nextDiagramState.globalStyle,
            },
          }
        : diagram,
    ),
  }
}

function asAppState(value: unknown): AppState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<AppState>
  if (!Array.isArray(candidate.diagrams)) return null
  if (typeof candidate.activeDiagramId !== 'string') return null

  const baselineStyle = defaultStyle()
  const normalized: AppState = {
    ...(candidate as AppState),
    diagrams: candidate.diagrams.map((diagram) => {
      const currentStyle = diagram.data?.globalStyle ?? baselineStyle
      return {
        ...diagram,
        parentCanvasId:
          typeof diagram.parentCanvasId === 'string' ? diagram.parentCanvasId : null,
        kind: diagram.kind === 'component' ? 'component' : 'page',
        sourceCanvasId:
          typeof diagram.sourceCanvasId === 'string' ? diagram.sourceCanvasId : null,
        componentAttributes: Array.isArray(diagram.componentAttributes)
          ? diagram.componentAttributes
          : [],
        data: {
          ...diagram.data,
          groups: Array.isArray(diagram.data?.groups) ? diagram.data.groups : [],
          portalViews: Array.isArray(diagram.data?.portalViews) ? diagram.data.portalViews : [],
          styleMode: diagram.data?.styleMode ?? 'UNICODE',
          globalStyle: {
            ...baselineStyle,
            ...currentStyle,
            arrowStartHead: false,
            arrowEndHead: false,
          },
        },
      }
    }),
  }

  return normalized
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

export function mergeExternalDiagramDataPreservingLocalDraft(
  currentDiagramState: DiagramState,
  canonicalDiagramData: DiagramData,
): DiagramData {
  const editMode = currentDiagramState.mode
  const preserveShapeId =
    editMode.M === 'TEXT_EDIT' ||
    editMode.M === 'LINE_TEXT_EDIT' ||
    editMode.M === 'RECTANGLE_TEXT_EDIT' ||
    editMode.M === 'RECTANGLE_LABEL_EDIT'
      ? editMode.shapeId
      : null

  if (!preserveShapeId) {
    return canonicalDiagramData
  }

  const localShapeObj = currentDiagramState.shapes.find(
    (shapeObj) => shapeObj.id === preserveShapeId,
  )
  if (!localShapeObj) {
    return canonicalDiagramData
  }

  const canonicalShapeIdx = canonicalDiagramData.shapes.findIndex(
    (shapeObj) => shapeObj.id === preserveShapeId,
  )
  const nextShapes =
    canonicalShapeIdx >= 0
      ? canonicalDiagramData.shapes.map((shapeObj, index) =>
          index === canonicalShapeIdx
            ? JSON.parse(JSON.stringify(localShapeObj))
            : shapeObj,
        )
      : [...canonicalDiagramData.shapes, JSON.parse(JSON.stringify(localShapeObj))]

  return {
    ...canonicalDiagramData,
    shapes: nextShapes,
  }
}

export function AsciipEditorShell({
  documentId,
  editorState,
  onEditorStateChange,
  onLiveEditorStateChange,
  onCommandBatch,
  currentCollaboratorName,
  portalMirrorConfig,
  onPortalMirrorConfigChange,
  accessSummary,
  collaborators,
  canManagePortals,
  onEditorMetaChange,
  onCreateFenceFromBounds,
  onUpdateFence,
  onDeleteFence,
  onOpenFenceShare,
  onFenceDraftBoundsChange,
  canCreatePortalDocuments,
  onResolvePortalTarget,
  onOpenPortalDestination,
  portalTargetShapeMap,
  componentDefinitionMap,
  portalNavigationFocus,
  onPortalNavigationFocusHandled,
  onDismissPortalNavigationFocus,
  toolbarLeading,
  toolbarFullscreen,
  toolbarTrailing,
  terminalPreview,
  onRequestCreateComponentFromSelection,
  showHistory,
  focusPoint,
  showCollaboratorOverlays,
}: {
  documentId: string
  editorState: Record<string, unknown> | null
  onEditorStateChange: (next: AppState) => void
  onLiveEditorStateChange?: (next: AppState) => void
  onCommandBatch?: (payload: AsciipCommittedState) => void
  currentCollaboratorName?: string | null
  portalMirrorConfig?: {
    sourcePortalId: string | null
    targetPortalId: string | null
  }
  onPortalMirrorConfigChange?: (next: {
    sourcePortalId: string | null
    targetPortalId: string | null
  }) => void
  accessSummary?: EditorCollaborationProps['accessSummary']
  collaborators?: EditorCollaborationProps['collaborators']
  canManagePortals?: EditorCollaborationProps['canManagePortals']
  onEditorMetaChange?: EditorCollaborationProps['onEditorMetaChange']
  onCreateFenceFromBounds?: EditorCollaborationProps['onCreateFenceFromBounds']
  onUpdateFence?: EditorCollaborationProps['onUpdateFence']
  onDeleteFence?: EditorCollaborationProps['onDeleteFence']
  onOpenFenceShare?: EditorCollaborationProps['onOpenFenceShare']
  onFenceDraftBoundsChange?: EditorCollaborationProps['onFenceDraftBoundsChange']
  canCreatePortalDocuments?: EditorCollaborationProps['canCreatePortalDocuments']
  onResolvePortalTarget?: EditorCollaborationProps['onResolvePortalTarget']
  onOpenPortalDestination?: EditorCollaborationProps['onOpenPortalDestination']
  portalTargetShapeMap?: EditorCollaborationProps['portalTargetShapeMap']
  componentDefinitionMap?: EditorCollaborationProps['componentDefinitionMap']
  portalNavigationFocus?: EditorCollaborationProps['portalNavigationFocus']
  onPortalNavigationFocusHandled?: EditorCollaborationProps['onPortalNavigationFocusHandled']
  onDismissPortalNavigationFocus?: EditorCollaborationProps['onDismissPortalNavigationFocus']
  toolbarLeading?: ReactNode
  toolbarFullscreen?: ReactNode
  toolbarTrailing?: ReactNode
  terminalPreview?: EditorTerminalPreview | null
  onRequestCreateComponentFromSelection?: EditorCollaborationProps['onRequestCreateComponentFromSelection']
  showHistory?: boolean
  focusPoint?: {
    row: number
    col: number
    key: string
  } | null
  showCollaboratorOverlays?: boolean
}) {
  const normalizedState = useMemo(() => {
    return asAppState(editorState) ?? initAppState()
  }, [editorState])
  const initialState = useMemo(() => normalizedState, [documentId])
  const persistRef = useRef(onEditorStateChange)
  const liveStateRef = useRef(onLiveEditorStateChange)
  const commandBatchRef = useRef(onCommandBatch)
  const lastAppliedExternalStateRef = useRef(JSON.stringify(initialState))
  const lastPublishedLiveStateRef = useRef(JSON.stringify(initialState))
  const pendingLiveStateRef = useRef<AppState | null>(null)
  const livePublishFrameRef = useRef<number | null>(null)
  persistRef.current = onEditorStateChange
  liveStateRef.current = onLiveEditorStateChange
  commandBatchRef.current = onCommandBatch

  const store = useMemo(
    () =>
      createAsciipStore({
        documentId,
        initialAppState: initialState,
        onPersistState: (next) => {
          // Ignore the parent echo for locally-originated edits so drawing does not reset mid-stroke.
          lastAppliedExternalStateRef.current = JSON.stringify(next)
          persistRef.current(next)
        },
        onCommittedState: (payload) => {
          commandBatchRef.current?.(payload)
        },
      }),
    [documentId, initialState],
  )

  useEffect(() => {
    lastAppliedExternalStateRef.current = JSON.stringify(initialState)
    lastPublishedLiveStateRef.current = JSON.stringify(initialState)
  }, [documentId, initialState])

  useEffect(() => {
    const nextJson = stableJson(normalizedState)
    const currentStoreJson = stableJson(store.getState().app)
    if (nextJson === currentStoreJson) {
      lastAppliedExternalStateRef.current = nextJson
      lastPublishedLiveStateRef.current = nextJson
      return
    }
    if (nextJson === lastAppliedExternalStateRef.current) return
    lastAppliedExternalStateRef.current = nextJson
    lastPublishedLiveStateRef.current = nextJson

    const currentAppState = store.getState().app
    const activeDiagram =
      normalizedState.diagrams.find((diagram) => diagram.id === normalizedState.activeDiagramId) ?? null
    const canPatchDiagramDataInPlace =
      Boolean(activeDiagram) &&
      currentAppState.activeDiagramId === normalizedState.activeDiagramId &&
      currentAppState.diagrams.length === normalizedState.diagrams.length &&
      currentAppState.diagrams.every((diagram, index) => {
        const nextDiagram = normalizedState.diagrams[index]
        return diagram.id === nextDiagram?.id && diagram.name === nextDiagram?.name
      })

    if (canPatchDiagramDataInPlace && activeDiagram) {
      const mergedDiagramData = mergeExternalDiagramDataPreservingLocalDraft(
        store.getState().diagram,
        activeDiagram.data,
      )
      store.dispatch(
        diagramActions.applyCommittedDiagramState({
          nextState: store.getState().diagram,
          canonicalDiagramData: mergedDiagramData,
        }),
      )
      store.dispatch(appActions.updateDiagramData(mergedDiagramData))
      return
    }

    store.dispatch(appActions.replaceAppState(normalizedState))
  }, [normalizedState, store])

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()
      const nextAppState = mergeLiveDiagramState(state.app, {
        canvasSize: state.diagram.canvasSize,
        shapes: state.diagram.shapes,
        groups: state.diagram.groups,
        portalViews: state.diagram.portalViews,
        styleMode: state.diagram.styleMode,
        globalStyle: state.diagram.globalStyle,
      })
      const nextJson = JSON.stringify(nextAppState)
      if (nextJson === lastPublishedLiveStateRef.current) return
      lastPublishedLiveStateRef.current = nextJson
      pendingLiveStateRef.current = nextAppState
      if (livePublishFrameRef.current != null) return
      livePublishFrameRef.current = window.requestAnimationFrame(() => {
        livePublishFrameRef.current = null
        const pendingState = pendingLiveStateRef.current
        pendingLiveStateRef.current = null
        if (!pendingState) return
        liveStateRef.current?.(pendingState)
      })
    })

    return () => {
      unsubscribe()
      if (livePublishFrameRef.current != null) {
        window.cancelAnimationFrame(livePublishFrameRef.current)
        livePublishFrameRef.current = null
      }
      pendingLiveStateRef.current = null
    }
  }, [store])

  return (
    <Provider store={store}>
      <TooltipProvider delay={150}>
        <App
          currentDocumentId={documentId}
          toolbarLeading={toolbarLeading}
          toolbarFullscreen={toolbarFullscreen}
          toolbarTrailing={toolbarTrailing}
          currentCollaboratorName={currentCollaboratorName}
          portalMirrorConfig={portalMirrorConfig}
          onPortalMirrorConfigChange={onPortalMirrorConfigChange}
          accessSummary={accessSummary}
          collaborators={collaborators}
          canManagePortals={canManagePortals}
          onEditorMetaChange={onEditorMetaChange}
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
          terminalPreview={terminalPreview}
          onRequestCreateComponentFromSelection={onRequestCreateComponentFromSelection}
          showHistory={showHistory}
          focusPoint={focusPoint}
          showCollaboratorOverlays={showCollaboratorOverlays}
        />
      </TooltipProvider>
    </Provider>
  )
}
