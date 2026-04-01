import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { normalizeTlBr } from "../../models/shapes";
import { CELL_HEIGHT, CELL_WIDTH, DrawOptions, canvasDraw } from "./draw";
import { TextShapeInput } from "./TextShapeInput";
import { LineTextFloatingControls } from "./LineTextFloatingControls";
import { RectangleTextFloatingControls } from "./RectangleTextFloatingControls";
import { ShapeStyleFloatingControls } from "./ShapeStyleFloatingControls";
import { TextFloatingControls } from "./TextFloatingControls";
import { CanvasOverlayLayer } from "./CanvasOverlayLayer";
import { CanvasPortalViewLayer } from "./CanvasPortalViewLayer";
import { useCanvasInteractionController } from "./useCanvasInteractionController";
import { selectors } from "../../store/selectors";
import { getBoundingBox, getBoundingBoxOfAll, getShapeObjAtCoordsPreferSelected } from "../../models/shapeInCanvas";
import { editorTheme } from "../../theme";
import type { StyleMode } from "../../models/style";
import { createPortalPreviewShapes, createPortalView, getPortalTargetRect, isPointWithinPortalRect, mapPointFromPortalToTarget, type CanvasPortalView } from "@/lib/canvascii/live-portals";
import type { PortalCreationMode } from "@/lib/canvascii/live-portals";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  getCanvasCollaboratorStableId,
  type CanvasAccessSummary,
  type CanvasCollaboratorPresence,
  type CanvasResolvedPortalAccess,
} from "@canvascii/core";
import { canViewerSeeCollaboratorCursor, canViewerSeeCollaboratorViewport } from "@/lib/canvascii/collaboration";
import type { EditorTerminalPreview } from "@/lib/canvascii/collaboration";
import type { ActionMode, ShapeObject } from "../../store/diagramSlice";
import { X } from "lucide-react";
import {
  getBindableShapeBounds,
  getBindableShapeHitAtCoords,
  getMultiSegmentPointHandles,
  isLineLikeShape,
} from "../../models/lineFeatures";
import type { Coords } from "../../models/shapes";
import { getRectangleBorderLabelStart } from "../../models/rectangleText";

function getBoundEndpointCells(shapeObj: ShapeObject): Coords[] {
  if (!isLineLikeShape(shapeObj.shape)) {
    return [];
  }

  const cells: Coords[] = [];
  if (shapeObj.shape.startBinding) {
    cells.push(shapeObj.shape.type === "LINE" ? shapeObj.shape.start : shapeObj.shape.segments[0]?.start);
  }
  if (shapeObj.shape.endBinding) {
    cells.push(
      shapeObj.shape.type === "LINE"
        ? shapeObj.shape.end
        : shapeObj.shape.segments[shapeObj.shape.segments.length - 1]?.end,
    );
  }

  return cells.filter((cell): cell is Coords => cell != null);
}

function getHoveredBoundEndpoint(
  shapeObj: ShapeObject | undefined,
  hoveredCell: Coords | null,
): {
  shapeId: string;
  endpoint: "START" | "END";
  cell: Coords;
  locked: boolean;
} | null {
  if (!shapeObj || !hoveredCell || !isLineLikeShape(shapeObj.shape)) {
    return null;
  }

  const startCell =
    shapeObj.shape.type === "LINE" ? shapeObj.shape.start : shapeObj.shape.segments[0]?.start;
  const endCell =
    shapeObj.shape.type === "LINE"
      ? shapeObj.shape.end
      : shapeObj.shape.segments[shapeObj.shape.segments.length - 1]?.end;

  if (
    startCell &&
    shapeObj.shape.startBinding &&
    startCell.r === hoveredCell.r &&
    startCell.c === hoveredCell.c
  ) {
    return {
      shapeId: shapeObj.id,
      endpoint: "START",
      cell: startCell,
      locked: Boolean(shapeObj.shape.startBinding.locked),
    };
  }

  if (
    endCell &&
    shapeObj.shape.endBinding &&
    endCell.r === hoveredCell.r &&
    endCell.c === hoveredCell.c
  ) {
    return {
      shapeId: shapeObj.id,
      endpoint: "END",
      cell: endCell,
      locked: Boolean(shapeObj.shape.endBinding.locked),
    };
  }

  return null;
}

function isEndpointResizeMode(mode: ActionMode, shapeObj?: ShapeObject): boolean {
  if (!shapeObj || mode.M !== "RESIZE" || !isLineLikeShape(shapeObj.shape)) {
    return false;
  }

  if (shapeObj.shape.type === "LINE") {
    return (
      (mode.resizePoint.r === shapeObj.shape.start.r &&
        mode.resizePoint.c === shapeObj.shape.start.c) ||
      (mode.resizePoint.r === shapeObj.shape.end.r &&
        mode.resizePoint.c === shapeObj.shape.end.c)
    );
  }

  const first = shapeObj.shape.segments[0]?.start;
  const last = shapeObj.shape.segments[shapeObj.shape.segments.length - 1]?.end;
  return Boolean(
    (first && mode.resizePoint.r === first.r && mode.resizePoint.c === first.c) ||
      (last && mode.resizePoint.r === last.r && mode.resizePoint.c === last.c),
  );
}

type PortalRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type PortalEditSession =
  | {
      kind: "move";
      portalId: string;
      startClientX: number;
      startClientY: number;
      initialRect: PortalRect;
    }
  | {
      kind: "resize";
      portalId: string;
      handle: "nw" | "ne" | "sw" | "se";
      startClientX: number;
      startClientY: number;
      initialRect: PortalRect;
    };

function samePortalRect(left: PortalRect, right: PortalRect) {
  return (
    left.top === right.top &&
    left.left === right.left &&
    left.width === right.width &&
    left.height === right.height
  );
}

function getPortalRectForSession(session: PortalEditSession, clientX: number, clientY: number): PortalRect {
  const deltaCols = Math.round((clientX - session.startClientX) / CELL_WIDTH);
  const deltaRows = Math.round((clientY - session.startClientY) / CELL_HEIGHT);

  if (session.kind === "move") {
    return {
      top: Math.max(0, session.initialRect.top + deltaRows),
      left: Math.max(0, session.initialRect.left + deltaCols),
      width: session.initialRect.width,
      height: session.initialRect.height,
    };
  }

  const topEdge = session.initialRect.top;
  const bottomEdge = session.initialRect.top + session.initialRect.height - 1;
  const leftEdge = session.initialRect.left;
  const rightEdge = session.initialRect.left + session.initialRect.width - 1;

  const movedTop = session.handle.startsWith("n") ? Math.max(0, topEdge + deltaRows) : topEdge;
  const movedBottom = session.handle.startsWith("s") ? Math.max(0, bottomEdge + deltaRows) : bottomEdge;
  const movedLeft = session.handle.endsWith("w") ? Math.max(0, leftEdge + deltaCols) : leftEdge;
  const movedRight = session.handle.endsWith("e") ? Math.max(0, rightEdge + deltaCols) : rightEdge;

  const nextTop = Math.min(movedTop, movedBottom);
  const nextBottom = Math.max(movedTop, movedBottom);
  const nextLeft = Math.min(movedLeft, movedRight);
  const nextRight = Math.max(movedLeft, movedRight);

  return {
    top: nextTop,
    left: nextLeft,
    width: Math.max(1, nextRight - nextLeft + 1),
    height: Math.max(1, nextBottom - nextTop + 1),
  };
}

function getShapeObjNearCoordsPreferSelected(
  shapes: ShapeObject[],
  coords: Coords,
  selectedShapeIds: string[],
  globalStyle: Record<string, unknown>,
  tolerance = 3,
): ShapeObject | null {
  const directHit = getShapeObjAtCoordsPreferSelected(shapes, coords, selectedShapeIds, globalStyle);
  if (directHit) {
    return directHit;
  }

  const selectedIdSet = new Set(selectedShapeIds);
  const nearbyShapes = shapes.filter((shapeObj) => {
    const bounds = getBoundingBox(shapeObj.shape);
    return (
      coords.r >= bounds.top - tolerance &&
      coords.r <= bounds.bottom + tolerance &&
      coords.c >= bounds.left - tolerance &&
      coords.c <= bounds.right + tolerance
    );
  });

  if (nearbyShapes.length === 0) {
    return shapes.length === 1 ? shapes[0] : null;
  }

  const selectedNearbyShapes = nearbyShapes.filter((shapeObj) => selectedIdSet.has(shapeObj.id));
  const pool = selectedNearbyShapes.length > 0 ? selectedNearbyShapes : nearbyShapes;
  return pool[pool.length - 1] ?? null;
}

export default function Canvas({
  currentDocumentId,
  currentCollaboratorName,
  portalMirrorConfig,
  onPortalMirrorConfigChange,
  accessSummary,
  collaborators,
  canManagePortals,
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
  terminalPreview,
  onViewportBoundsChange,
  onRequestCreateComponentFromSelection,
  focusPoint,
  showCollaboratorOverlays = true,
}: {
  currentDocumentId: string;
  currentCollaboratorName?: string | null;
  portalMirrorConfig?: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  };
  onPortalMirrorConfigChange?: (next: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  }) => void;
  accessSummary?: CanvasAccessSummary | null;
  collaborators?: CanvasCollaboratorPresence[];
  canManagePortals?: boolean;
  onCreateFenceFromBounds?: (bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onUpdateFence?: (input: {
    fenceId: string;
    top: number;
    left: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onDeleteFence?: (fenceId: string) => Promise<void>;
  onOpenFenceShare?: (fenceId: string) => void;
  onFenceDraftBoundsChange?: (bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null) => void;
  canCreatePortalDocuments?: boolean;
  onResolvePortalTarget?: (input: {
    mode: "new-canvas" | "same-canvas";
    rect: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
    activeCanvasId: string;
  }) => Promise<{
    documentId: string | null;
    canvasId: string;
    top: number;
    left: number;
    label?: string | null;
  }>;
  onOpenPortalDestination?: (input: {
    portalId: string;
    label: string;
    sourceDocumentId: string | null;
    sourceCanvasId: string;
    sourceRect: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
    target: {
      documentId: string | null;
      canvasId: string;
      top: number;
      left: number;
      width: number;
      height: number;
    };
  }) => void;
  portalTargetShapeMap?: Record<string, ShapeObject[]>;
  componentDefinitionMap?: Record<string, {
    name: string;
    attributes: Array<{
      key: string;
      defaultValue: string;
    }>;
    canvasSize: {
      rows: number;
      cols: number;
    };
  }>;
  portalNavigationFocus?: {
    canvasId: string;
    rect: {
      top: number;
      left: number;
      width: number;
      height: number;
    };
    label?: string | null;
  } | null;
  onPortalNavigationFocusHandled?: () => void;
  onDismissPortalNavigationFocus?: () => void;
  terminalPreview?: EditorTerminalPreview | null;
  onViewportBoundsChange?: (bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  } | null) => void;
  onRequestCreateComponentFromSelection?: (shapeIds?: string[]) => void;
  focusPoint?: {
    row: number;
    col: number;
    key: string;
  } | null;
  showCollaboratorOverlays?: boolean;
}) {
  const interactions = useEditorInteractions();

  //#region selectors
  const rowCount = useAppSelector((state) => state.diagram.canvasSize.rows);
  const colCount = useAppSelector((state) => state.diagram.canvasSize.cols);
  const activeCanvasId = useAppSelector((state) => state.app.activeDiagramId);
  const canvasWidth = colCount * CELL_WIDTH;
  const canvasHeight = rowCount * CELL_HEIGHT;

  const currentHoveredCell = useAppSelector(
    (state) => state.diagram.currentHoveredCell
  );

  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const shapeObjs = useAppSelector((state) => state.diagram.shapes);
  const portalViews = useAppSelector((state) => state.diagram.portalViews);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const selectedShapeObjs = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );
  const selectedBounds = useMemo(
    () => getBoundingBoxOfAll(selectedShapeObjs.map((shapeObj) => shapeObj.shape)),
    [selectedShapeObjs]
  );
  const newShape = useAppSelector((state) =>
    selectors.currentCreatedShape(state.diagram)
  );
  const currentEditedText = useAppSelector((state) =>
    selectors.currentEditedText(state.diagram)
  );
  const textCursorCell = useAppSelector((state) => state.diagram.textCursorCell);
  const pendingCanvasScroll = useAppSelector(
    (state) => state.diagram.pendingCanvasScroll
  );
  const selectedPathPoint = useAppSelector((state) => state.diagram.selectedPathPoint);
  const [contextMenuSelectionIds, setContextMenuSelectionIds] = useState<string[]>([]);
  const contextMenuSelectionIdsRef = useRef<string[]>([]);
  const [canvasContextMenuOpen, setCanvasContextMenuOpen] = useState(false);
  const canCreateComponentFromSelection = Boolean(onRequestCreateComponentFromSelection);

  const nextActionOnClick = useAppSelector((state) =>
    selectors.getPointer(state.diagram)
  );
  const mode = useAppSelector((state) => state.diagram.mode);
  const [cursorBlinkOn, setCursorBlinkOn] = useState(true);
  const [selectedFenceId, setSelectedFenceId] = useState<string | null>(null);
  const [selectedPortalViewId, setSelectedPortalViewId] = useState<string | null>(null);
  const [pendingPortalCreation, setPendingPortalCreation] = useState<{
    rect: PortalRect;
    mode: PortalCreationMode;
    submitting: boolean;
  } | null>(null);
  const [portalTransientRect, setPortalTransientRect] = useState<{
    fenceId: string;
    rect: PortalRect;
  } | null>(null);
  const [pendingPortalPreview, setPendingPortalPreview] = useState<CanvasResolvedPortalAccess | null>(null);
  const [portalViewTransientRect, setPortalViewTransientRect] = useState<{
    portalViewId: string;
    rect: PortalRect;
  } | null>(null);
  const lastPublishedPortalDraftRef = useRef<string | null>(null);
  const isReadOnly = Boolean(accessSummary && !accessSummary.canEditSomewhere);
  const isPanToolActive = selectedTool === "PAN";
  const portalEditSessionRef = useRef<PortalEditSession | null>(null);
  const portalViewEditSessionRef = useRef<PortalEditSession | null>(null);
  const portals = useMemo(
    () => accessSummary?.portals.filter((portal) => portal.canvasId === activeCanvasId) ?? [],
    [accessSummary?.portals, activeCanvasId],
  );
  const resolvedCursorCell = useMemo(() => {
    if (!currentEditedText) return null;
    if (textCursorCell) return textCursorCell;

    const lines = currentEditedText.lines;
    const lastRowOffset = Math.max(0, lines.length - 1);
    const lastLine = lines[lastRowOffset] ?? "";
    const lastColOffset = Array.from(lastLine).length;
    return {
      r: currentEditedText.start.r + lastRowOffset,
      c: currentEditedText.start.c + lastColOffset,
    };
  }, [currentEditedText, textCursorCell]);

  const selectedRectangleLabelInsertHandle = useMemo(() => {
    if (selectedShapeObjs.length !== 1) return null;
    if (mode.M === "RECTANGLE_LABEL_EDIT") return null;

    const [shapeObj] = selectedShapeObjs;
    if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") return null;
    if ((shapeObj.shape.label ?? "").trim().length > 0) return null;

    const start = getRectangleBorderLabelStart(shapeObj.shape);
    return {
      shapeId: shapeObj.id,
      row: start.row,
      col: start.col,
    };
  }, [mode.M, selectedShapeObjs]);

  const {
    canvasRef,
    containerRef,
    pointerActiveRef,
    panSessionRef,
    portalDraftBounds,
    getCellCoords,
    canEditAtCoords,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleMouseLeave,
    handleDoubleClick,
  } = useCanvasInteractionController({
    activeCanvasId,
    accessSummary,
    canReadOnlyBlock: isReadOnly,
    isPanToolActive,
    mode,
    selectedTool,
    pendingCanvasScroll,
    onConsumePendingCanvasScroll: interactions.consumePendingCanvasScroll,
    onPointerDown: interactions.pointerDown,
    onPointerHover: interactions.pointerHover,
    onPointerUp: interactions.pointerUp,
    onPointerClick: interactions.pointerClick,
    onPointerDoubleClick: interactions.pointerDoubleClick,
    onPointerLeave: interactions.pointerLeave,
    onEnableMoveDuplication: interactions.enableMoveDuplication,
    onCreateFenceFromBounds: onCreateFenceFromBounds
      ? async (bounds) => {
          const previewId = `pending-portal:${Date.now()}`;
          const now = new Date().toISOString();
          setPendingPortalPreview({
            id: previewId,
            canvasId: activeCanvasId,
            label: "Creating fence",
            color: "#38bdf8",
            access: "owner",
            rect: bounds,
            createdAt: now,
            updatedAt: now,
          });
          try {
            await onCreateFenceFromBounds(bounds);
          } finally {
            setPendingPortalPreview((current) => (current?.id === previewId ? null : current));
          }
        }
      : undefined,
    onFenceCreated: () => {
      interactions.setTool("SELECT");
    },
    onCreatePortalViewFromBounds: (bounds) => {
      setPendingPortalCreation({
        rect: bounds,
        mode: canCreatePortalDocuments ? "new-canvas" : "same-canvas",
        submitting: false,
      });
    },
    onPortalViewCreated: () => {
      interactions.setTool("SELECT");
    },
    mapInteractionCoords: (coords) => {
      const interactivePortalView = [...portalViews]
        .reverse()
        .find((portalView) =>
          portalView.canvasId === activeCanvasId &&
          portalView.target.documentId == null &&
          portalView.target.canvasId === activeCanvasId &&
          isPointWithinPortalRect(portalView.rect, coords),
        );

      return interactivePortalView ? mapPointFromPortalToTarget(interactivePortalView, coords) : coords;
    },
  });

  const handleCanvasContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const coords = getCellCoords(event.clientX, event.clientY);
      const selectedShapeIds = selectedShapeObjs.map((shapeObj) => shapeObj.id);
      const hitShape = getShapeObjNearCoordsPreferSelected(shapeObjs, coords, selectedShapeIds, globalStyle);
      if (!hitShape) {
        flushSync(() => {
          setContextMenuSelectionIds(selectedShapeIds);
        });
        contextMenuSelectionIdsRef.current = selectedShapeIds;
        return;
      }

      const nextSelectionIds =
        selectedShapeIds.includes(hitShape.id) && selectedShapeIds.length > 0 ? selectedShapeIds : [hitShape.id];
      flushSync(() => {
        setContextMenuSelectionIds(nextSelectionIds);
      });
      contextMenuSelectionIdsRef.current = nextSelectionIds;
    },
    [getCellCoords, selectedShapeObjs, shapeObjs],
  );

  const handleCreateComponentContextAction = useCallback((shapeIds?: string[]) => {
    onRequestCreateComponentFromSelection?.(shapeIds && shapeIds.length > 0 ? shapeIds : undefined);
  }, [onRequestCreateComponentFromSelection]);

  const triggerCreateComponentFromContextSelection = useCallback(() => {
    const selectedIds = [...contextMenuSelectionIdsRef.current];
    setCanvasContextMenuOpen(false);
    window.setTimeout(() => {
      handleCreateComponentContextAction(selectedIds);
    }, 0);
  }, [handleCreateComponentContextAction]);

  const renderedPortals = useMemo(
    () =>
      [
        ...portals.map((portal) =>
          portalTransientRect?.fenceId === portal.id
            ? { ...portal, rect: portalTransientRect.rect }
            : portal,
        ),
        ...(pendingPortalPreview ? [pendingPortalPreview] : []),
      ],
    [pendingPortalPreview, portalTransientRect, portals],
  );

  const renderedPortalViews = useMemo(
    () =>
      portalViews.map((portalView) =>
        portalViewTransientRect?.portalViewId === portalView.id
          ? { ...portalView, rect: portalViewTransientRect.rect }
          : portalView,
      ),
    [portalViewTransientRect, portalViews],
  );

  const selectedPortalView = useMemo(
    () => renderedPortalViews.find((portalView) => portalView.id === selectedPortalViewId) ?? null,
    [renderedPortalViews, selectedPortalViewId],
  );
  const selectedComponentDefinition = useMemo(() => {
    if (!selectedPortalView || selectedPortalView.viewType !== "component") {
      return null;
    }
    const scopedKey = `${selectedPortalView.target.documentId ?? currentDocumentId}:${selectedPortalView.target.canvasId}`;
    return componentDefinitionMap?.[scopedKey] ?? null;
  }, [componentDefinitionMap, currentDocumentId, selectedPortalView]);

  const handleConfirmPortalCreation = useCallback(async () => {
    if (!pendingPortalCreation) return;

    const mode = pendingPortalCreation.mode;
    const rect = pendingPortalCreation.rect;
    setPendingPortalCreation((current) => current ? { ...current, submitting: true } : current);

    try {
      const target = onResolvePortalTarget
        ? await onResolvePortalTarget({
            mode,
            rect,
            activeCanvasId,
          })
        : {
            documentId: currentDocumentId,
            canvasId: activeCanvasId,
            top: rect.top,
            left: rect.left,
            label: null,
          };

      const nextPortalView = createPortalView({
        canvasId: activeCanvasId,
        rect,
        label: target.label ?? undefined,
        index: portalViews.length,
        target: {
          documentId: target.documentId,
          canvasId: target.canvasId,
          top: target.top,
          left: target.left,
        },
      });
      interactions.addPortalView(nextPortalView);
      setSelectedPortalViewId(nextPortalView.id);
      setPendingPortalCreation(null);
    } catch (_error) {
      setPendingPortalCreation((current) => current ? { ...current, submitting: false } : current);
    }
  }, [
    activeCanvasId,
    currentDocumentId,
    interactions,
    onResolvePortalTarget,
    pendingPortalCreation,
    portalViews.length,
  ]);

  const portalPreviewShapeObjs = useMemo(
    () =>
      renderedPortalViews.flatMap((portalView) => {
        if (portalView.canvasId !== activeCanvasId) {
          return [];
        }

        const targetDocumentId = portalView.target.documentId ?? currentDocumentId;
        const targetShapes =
          targetDocumentId === currentDocumentId && portalView.target.canvasId === activeCanvasId
            ? shapeObjs
            : (portalTargetShapeMap?.[`${targetDocumentId}:${portalView.target.canvasId}`] ?? []);
        const componentDefinition =
          portalView.viewType === "component"
            ? componentDefinitionMap?.[`${targetDocumentId}:${portalView.target.canvasId}`] ?? null
            : null;
        const resolvedComponentProps = componentDefinition
          ? {
              ...Object.fromEntries(
                componentDefinition.attributes.map((attribute) => [attribute.key, attribute.defaultValue]),
              ),
              ...(portalView.componentProps ?? {}),
            }
          : portalView.componentProps;

        return createPortalPreviewShapes({
          portal: portalView,
          shapes: targetShapes,
          sourceCanvasSize: componentDefinition?.canvasSize ?? null,
          resolvedComponentProps,
        });
      }),
    [activeCanvasId, componentDefinitionMap, currentDocumentId, portalTargetShapeMap, renderedPortalViews, shapeObjs],
  );

  const hoveredBindingTarget = useMemo(() => {
    if (
      !currentHoveredCell ||
      !canEditAtCoords(currentHoveredCell)
    ) {
      return null;
    }

    const selectedShape = selectedShapeObjs.length === 1 ? selectedShapeObjs[0] : undefined;
    const canPreviewBinding =
      selectedTool === "LINE" ||
      selectedTool === "MULTI_SEGMENT_LINE" ||
      isEndpointResizeMode(mode, selectedShape);
    if (!canPreviewBinding) {
      return null;
    }

    return getBindableShapeHitAtCoords(shapeObjs, currentHoveredCell);
  }, [canEditAtCoords, currentHoveredCell, mode, selectedShapeObjs, selectedTool, shapeObjs]);

  const hoveredBindingLockTarget = useMemo(
    () =>
      selectedShapeObjs.length === 1
        ? getHoveredBoundEndpoint(selectedShapeObjs[0], currentHoveredCell)
        : null,
    [currentHoveredCell, selectedShapeObjs],
  );

  const visibleBindingAnchors = useMemo(() => {
    const anchors: Coords[] = [];

    selectedShapeObjs.forEach((shapeObj) => {
      anchors.push(...getBoundEndpointCells(shapeObj));
    });

    if (newShape && isLineLikeShape(newShape)) {
      const previewShapeObj: ShapeObject = {
        id: "__line-preview__",
        shape: newShape,
      };
      anchors.push(...getBoundEndpointCells(previewShapeObj));
    }

    return anchors;
  }, [newShape, selectedShapeObjs]);

  const selectedPathPoints = useMemo(() => {
    if (selectedShapeObjs.length !== 1 || selectedShapeObjs[0]?.shape.type !== "MULTI_SEGMENT_LINE") {
      return [];
    }

    return getMultiSegmentPointHandles(selectedShapeObjs[0].shape).map((handle) => ({
      ...handle,
      selected:
        selectedPathPoint?.shapeId === selectedShapeObjs[0]?.id &&
        selectedPathPoint.pointIndex === handle.pointIndex,
    }));
  }, [selectedPathPoint, selectedShapeObjs]);

  const visibleCollaborators = useMemo(
    () =>
      (collaborators ?? []).filter((collaborator) => {
        const cursorVisible =
          !collaborator.cursor ||
          collaborator.cursor.canvasId !== activeCanvasId ||
          canViewerSeeCollaboratorCursor(accessSummary, collaborator.cursor);
        const viewportVisible =
          !collaborator.viewport ||
          collaborator.viewport.canvasId !== activeCanvasId ||
          canViewerSeeCollaboratorViewport(accessSummary, collaborator.viewport);

        return cursorVisible && viewportVisible;
      }),
    [accessSummary, activeCanvasId, collaborators],
  );

  const overlayCollaborators = useMemo(
    () =>
      showCollaboratorOverlays
        ? visibleCollaborators.filter((collaborator) => {
            if (collaborator.status !== "editing") {
              return false;
            }

            return (
              collaborator.cursor?.canvasId === activeCanvasId ||
              collaborator.viewport?.canvasId === activeCanvasId ||
              collaborator.draft?.canvasId === activeCanvasId
            );
          })
        : [],
    [activeCanvasId, showCollaboratorOverlays, visibleCollaborators],
  );

  const collaboratorPortalDrafts = useMemo(
    () =>
      visibleCollaborators.flatMap((collaborator) =>
        collaborator.draft?.kind === "portal" && collaborator.draft.canvasId === activeCanvasId
          ? [
              {
                userId: getCanvasCollaboratorStableId(collaborator),
                name: collaborator.name,
                color: collaborator.color,
                rect: collaborator.draft.rect,
              },
            ]
          : [],
      ),
    [activeCanvasId, visibleCollaborators],
  );

  const collaboratorDraftShapes = useMemo(
    () =>
      visibleCollaborators.flatMap((collaborator) =>
        collaborator.draft?.canvasId === activeCanvasId
          ? collaborator.draft.kind === "shape"
            ? [
                {
                  userId: getCanvasCollaboratorStableId(collaborator),
                  color: collaborator.color,
                  styleMode: (collaborator.draft.styleMode === "ASCII" ? "ASCII" : "UNICODE") as StyleMode,
                  globalStyle: (collaborator.draft.style as typeof globalStyle | null) ?? globalStyle,
                  shapeObj: {
                    id: `collab-draft:${getCanvasCollaboratorStableId(collaborator)}`,
                    shape: collaborator.draft.shape as ShapeObject["shape"],
                  } satisfies ShapeObject,
                },
              ]
            : collaborator.draft.kind === "objects"
              ? (() => {
                  const objectDraft = collaborator.draft;
                  return objectDraft.objects.map((draftObject, index) => ({
                    userId: `${getCanvasCollaboratorStableId(collaborator)}:${draftObject.id}:${index}`,
                    color: collaborator.color,
                    styleMode: (objectDraft.styleMode === "ASCII" ? "ASCII" : "UNICODE") as StyleMode,
                    globalStyle: (objectDraft.style as typeof globalStyle | null) ?? globalStyle,
                    shapeObj: {
                      id: `collab-draft:${getCanvasCollaboratorStableId(collaborator)}:${draftObject.id}`,
                      shape: draftObject.shape as ShapeObject["shape"],
                      style: (draftObject.style as ShapeObject["style"]) ?? undefined,
                    } satisfies ShapeObject,
                  }));
                })()
              : []
          : [],
      ),
    [activeCanvasId, globalStyle, visibleCollaborators],
  );

  const portalPreviewDraftShapes = useMemo(
    () =>
      !newShape
        ? []
        : renderedPortalViews.flatMap((portalView) => {
          if (
            portalView.canvasId !== activeCanvasId ||
              (portalView.target.documentId ?? currentDocumentId) !== currentDocumentId ||
              portalView.target.canvasId !== activeCanvasId
            ) {
              return [];
            }

            const targetDocumentId = portalView.target.documentId ?? currentDocumentId;
            const componentDefinition =
              portalView.viewType === "component"
                ? componentDefinitionMap?.[`${targetDocumentId}:${portalView.target.canvasId}`] ?? null
                : null;

            return createPortalPreviewShapes({
              portal: portalView,
              shapes: [{ id: "__draft__", shape: newShape }],
              sourceCanvasSize: componentDefinition?.canvasSize ?? null,
            });
          }),
    [activeCanvasId, componentDefinitionMap, currentDocumentId, newShape, renderedPortalViews],
  );

  useEffect(() => {
    if (!terminalPreview || terminalPreview.kind === "info" || terminalPreview.canvasId !== activeCanvasId) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const previewTop =
      terminalPreview.kind === "point"
        ? terminalPreview.row
        : terminalPreview.kind === "line"
          ? Math.min(terminalPreview.from.row, terminalPreview.to.row)
          : terminalPreview.top;
    const previewLeft =
      terminalPreview.kind === "point"
        ? terminalPreview.col
        : terminalPreview.kind === "line"
          ? Math.min(terminalPreview.from.col, terminalPreview.to.col)
          : terminalPreview.left;

    container.scrollTo({
      top: Math.max(0, previewTop * CELL_HEIGHT - container.clientHeight / 2),
      left: Math.max(0, previewLeft * CELL_WIDTH - container.clientWidth / 2),
      behavior: "smooth",
    });
  }, [activeCanvasId, terminalPreview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const publishViewport = () => {
      const top = Math.max(0, Math.floor(container.scrollTop / CELL_HEIGHT));
      const left = Math.max(0, Math.floor(container.scrollLeft / CELL_WIDTH));
      const bottom = Math.min(rowCount, Math.ceil((container.scrollTop + container.clientHeight) / CELL_HEIGHT));
      const right = Math.min(colCount, Math.ceil((container.scrollLeft + container.clientWidth) / CELL_WIDTH));

      onViewportBoundsChange?.({
        top,
        left,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      });
    };

    publishViewport();
    container.addEventListener("scroll", publishViewport, { passive: true });
    const resizeObserver = new ResizeObserver(() => {
      publishViewport();
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener("scroll", publishViewport);
      resizeObserver.disconnect();
      onViewportBoundsChange?.(null);
    };
  }, [colCount, onViewportBoundsChange, rowCount]);

  useEffect(() => {
    if (!portalNavigationFocus || portalNavigationFocus.canvasId !== activeCanvasId) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const targetTop = Math.max(
      0,
      portalNavigationFocus.rect.top * CELL_HEIGHT - container.clientHeight / 3,
    );
    const targetLeft = Math.max(
      0,
      portalNavigationFocus.rect.left * CELL_WIDTH - container.clientWidth / 3,
    );
    container.scrollTo({
      top: targetTop,
      left: targetLeft,
      behavior: "smooth",
    });
    onPortalNavigationFocusHandled?.();
  }, [activeCanvasId, onPortalNavigationFocusHandled, portalNavigationFocus]);

  const jumpToCursor = (cursor: { row: number; col: number }) => {
    const container = containerRef.current;
    if (!container) return;

    const nextTop = Math.max(0, cursor.row * CELL_HEIGHT - container.clientHeight / 2);
    const nextLeft = Math.max(0, cursor.col * CELL_WIDTH - container.clientWidth / 2);
    container.scrollTo({
      top: nextTop,
      left: nextLeft,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    if (!focusPoint) return;
    jumpToCursor({ row: focusPoint.row, col: focusPoint.col });
  }, [focusPoint?.key]);

  useEffect(() => {
    if (selectedFenceId && !renderedPortals.some((portal) => portal.id === selectedFenceId)) {
      setSelectedFenceId(null);
    }
  }, [renderedPortals, selectedFenceId]);

  useEffect(() => {
    if (selectedPortalViewId && !renderedPortalViews.some((portalView) => portalView.id === selectedPortalViewId)) {
      setSelectedPortalViewId(null);
    }
  }, [renderedPortalViews, selectedPortalViewId]);

  useEffect(() => {
    const nextKey = portalDraftBounds ? JSON.stringify(portalDraftBounds) : "null";
    if (nextKey === lastPublishedPortalDraftRef.current) {
      return;
    }
    lastPublishedPortalDraftRef.current = nextKey;
    onFenceDraftBoundsChange?.(portalDraftBounds);
  }, [onFenceDraftBoundsChange, portalDraftBounds]);

  useEffect(() => {
    if (selectedTool !== "SELECT" && selectedTool !== "FENCE" && selectedFenceId) {
      setSelectedFenceId(null);
    }
    if (selectedTool !== "SELECT" && selectedTool !== "PORTAL" && selectedPortalViewId) {
      setSelectedPortalViewId(null);
    }
  }, [selectedFenceId, selectedPortalViewId, selectedTool]);

  useEffect(() => {
    const selectedEntityId = selectedPortalViewId ?? selectedFenceId;
    if ((!canManagePortals && !selectedPortalViewId) || !selectedEntityId) return;

    const isTypingTarget = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event)) return;
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (selectedPortalViewId) {
        interactions.deletePortalView(selectedPortalViewId);
        setSelectedPortalViewId(null);
        return;
      }
      void onDeleteFence?.(selectedFenceId!);
      setSelectedFenceId(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [canManagePortals, interactions, onDeleteFence, selectedFenceId, selectedPortalViewId]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const session = portalEditSessionRef.current;
      if (!session) return;
      setPortalTransientRect({
        fenceId: session.portalId,
        rect: getPortalRectForSession(session, event.clientX, event.clientY),
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const session = portalEditSessionRef.current;
      if (!session) return;
      const nextRect = getPortalRectForSession(session, event.clientX, event.clientY);
      portalEditSessionRef.current = null;
      if (!samePortalRect(nextRect, session.initialRect)) {
        setPortalTransientRect({
          fenceId: session.portalId,
          rect: nextRect,
        });
        if (onUpdateFence) {
          void onUpdateFence({
            fenceId: session.portalId,
            ...nextRect,
          }).finally(() => {
            setPortalTransientRect((current) =>
              current?.fenceId === session.portalId ? null : current,
            );
          });
        } else {
          setPortalTransientRect(null);
        }
      } else {
        setPortalTransientRect(null);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [onUpdateFence]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const session = portalViewEditSessionRef.current;
      if (!session) return;
      setPortalViewTransientRect({
        portalViewId: session.portalId,
        rect: getPortalRectForSession(session, event.clientX, event.clientY),
      });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const session = portalViewEditSessionRef.current;
      if (!session) return;
      const nextRect = getPortalRectForSession(session, event.clientX, event.clientY);
      portalViewEditSessionRef.current = null;
      if (!samePortalRect(nextRect, session.initialRect)) {
        setPortalViewTransientRect({
          portalViewId: session.portalId,
          rect: nextRect,
        });
        const portalView = renderedPortalViews.find((entry) => entry.id === session.portalId);
        if (portalView) {
          const sourceRect = getPortalTargetRect(portalView);
          interactions.updatePortalView({
            portalId: session.portalId,
            changes: {
              rect: nextRect,
              updatedAt: new Date().toISOString(),
              target: {
                ...portalView.target,
                top: sourceRect.top,
                left: sourceRect.left,
              },
            },
          });
        }
        setPortalViewTransientRect(null);
      } else {
        setPortalViewTransientRect(null);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interactions, renderedPortalViews]);

  useEffect(() => {
    if (!currentEditedText || !resolvedCursorCell) {
      setCursorBlinkOn(false);
      return;
    }

    setCursorBlinkOn(true);
    const intervalId = window.setInterval(() => {
      setCursorBlinkOn((prev) => !prev);
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [currentEditedText, resolvedCursorCell?.r, resolvedCursorCell?.c]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas == null) return;
    const ctx = canvas.getContext("2d")!;

    // Set canvas dimension
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvasDraw.setBackground(
      ctx,
      canvas.width,
      canvas.height,
      editorTheme.canvas.background
    );

    // Set the cursor
    const hoveredCellEditable =
      !currentHoveredCell || canEditAtCoords(currentHoveredCell);

    canvas.style.cursor =
      isPanToolActive
        ? panSessionRef.current
          ? "grabbing"
          : "grab"
        : isReadOnly || !hoveredCellEditable
        ? "not-allowed"
        : nextActionOnClick === "SELECT"
        ? "pointer"
        : nextActionOnClick === "MOVE"
        ? "move"
        : nextActionOnClick === "RESIZE"
        ? "grabbing"
        : nextActionOnClick === "CREATE"
        ? "copy"
        : "default";

    // Draw the grid
    canvasDraw.drawGrid(
      ctx,
      canvasWidth,
      canvasHeight,
      rowCount,
      colCount,
      editorTheme.canvas.grid
    );

    // Draw hovered cell
    if (currentHoveredCell && nextActionOnClick === "CREATE") {
      canvasDraw.drawHoveredCell(ctx, currentHoveredCell);
    }

    // Draw shapes
    const selectedShapeIds = selectedShapeObjs.map((s) => s.id);

    const drawOpts: DrawOptions[] = shapeObjs.map((so) => {
      const isShapeSelected = selectedShapeIds.includes(so.id);
      const color = isShapeSelected
        ? editorTheme.canvas.selectedShape
        : editorTheme.canvas.shape;
      const drawResizePoints: boolean =
        isShapeSelected &&
        selectedShapeObjs.length === 1 &&
        mode.M !== "SELECT_DRAG";

      const renderRectangleLabelAsEditor =
        mode.M === "RECTANGLE_TEXT_EDIT" && mode.shapeId === so.id;
      const renderRectangleBorderLabelAsEditor =
        mode.M === "RECTANGLE_LABEL_EDIT" && mode.shapeId === so.id;
      const renderLineLabelAsEditor =
        mode.M === "LINE_TEXT_EDIT" && mode.shapeId === so.id;

      return {
        color,
        drawResizePoints,
        renderRectangleLabelAsEditor,
        renderRectangleBorderLabelAsEditor,
        renderLineLabelAsEditor,
      };
    });

    canvasDraw.drawShapes(
      ctx,
      shapeObjs,
      styleMode,
      globalStyle,
      drawOpts,
      editorTheme.canvas.background
    );
    canvasDraw.drawShapes(
      ctx,
      portalPreviewShapeObjs,
      styleMode,
      globalStyle,
      portalPreviewShapeObjs.map(() => ({
        color: "rgba(226,232,240,0.94)",
        drawResizePoints: false,
      })),
      editorTheme.canvas.background,
    );

    // Draw new shape
    if (newShape) {
      if (selectedTool === "TEXT" && newShape.type === "RECTANGLE") {
        const previewShape: ShapeObject = {
          id: "__text-box-preview__",
          shape: newShape,
          style: {
            rectangleBorder: "NONE",
          },
        };
        canvasDraw.drawShapes(
          ctx,
          [previewShape],
          styleMode,
          globalStyle,
          [{ color: editorTheme.canvas.createdShape, drawResizePoints: false }],
          editorTheme.canvas.background
        );
      } else {
        canvasDraw.drawShapes(
          ctx,
          [newShape],
          styleMode,
          globalStyle,
          [{ color: editorTheme.canvas.createdShape, drawResizePoints: false }],
          editorTheme.canvas.background
        );
      }
    }

    if (portalPreviewDraftShapes.length > 0) {
      canvasDraw.drawShapes(
        ctx,
        portalPreviewDraftShapes,
        styleMode,
        globalStyle,
        portalPreviewDraftShapes.map(() => ({
          color: editorTheme.canvas.createdShape,
          drawResizePoints: false,
        })),
        editorTheme.canvas.background,
      );
    }

    collaboratorDraftShapes.forEach((draft) => {
      canvasDraw.drawShapes(
        ctx,
        [draft.shapeObj],
        draft.styleMode,
        draft.globalStyle,
        [{ color: draft.color, drawResizePoints: false }],
        editorTheme.canvas.background
      );
    });

    if (hoveredBindingTarget) {
      canvasDraw.drawBindingShapeOutline(
        ctx,
        getBindableShapeBounds(hoveredBindingTarget.shape),
        editorTheme.chrome.accentSoft,
      );
      canvasDraw.drawBindingAnchor(
        ctx,
        hoveredBindingTarget.anchor,
        editorTheme.chrome.accent,
      );
    }

    visibleBindingAnchors.forEach((cell) => {
      canvasDraw.drawBindingAnchor(ctx, cell, editorTheme.chrome.accentSoft);
    });

    selectedPathPoints.forEach((point) => {
      canvasDraw.drawPathPointHandle(
        ctx,
        point.coords,
        point.selected ? editorTheme.chrome.accent : editorTheme.chrome.accentSoft,
        point.selected,
      );
    });

    // Draw select box if I'm drag-selecting
    if (mode.M === "SELECT_DRAG") {
      const [tl, br] = normalizeTlBr(mode.start, mode.curr);
      canvasDraw.drawSelectBox(ctx, tl, br, editorTheme.canvas.selectBox);
    }

    if (
      selectedBounds &&
      selectedShapeObjs.length > 1 &&
      mode.M !== "SELECT_DRAG"
    ) {
      canvasDraw.drawBoundingBox(
        ctx,
        selectedBounds,
        editorTheme.canvas.selectedShape
      );
      canvasDraw.drawBoundingBoxResizePoints(
        ctx,
        selectedBounds,
        editorTheme.canvas.selectedShape
      );
    }

    if (
      currentEditedText &&
      resolvedCursorCell &&
      cursorBlinkOn &&
      mode.M !== "RECTANGLE_TEXT_EDIT" &&
      mode.M !== "RECTANGLE_LABEL_EDIT" &&
      mode.M !== "LINE_TEXT_EDIT"
    ) {
      canvasDraw.drawBlockCursor(
        ctx,
        resolvedCursorCell,
        editorTheme.chrome.accent
      );
    }
  }, [
    canvasHeight,
    canvasWidth,
    colCount,
    currentHoveredCell,
    globalStyle,
    mode,
    newShape,
    nextActionOnClick,
    rowCount,
    textCursorCell,
    resolvedCursorCell,
    selectedBounds,
    selectedShapeObjs,
    shapeObjs,
    styleMode,
    cursorBlinkOn,
    currentEditedText,
    isReadOnly,
    isPanToolActive,
    portalPreviewShapeObjs,
    portalPreviewDraftShapes,
    hoveredBindingTarget,
    hoveredBindingLockTarget,
    collaboratorDraftShapes,
    selectedPathPoints,
    selectedPathPoint,
    visibleBindingAnchors,
  ]);

  return (
    <div
      id="canvas-container"
      ref={containerRef}
      style={{
        flex: 1,
        overflow: "scroll",
        position: "relative",
        scrollbarColor: `${editorTheme.chrome.accentSoft} ${editorTheme.chrome.background}`,
      }}
    >
      <div className="pointer-events-none fixed left-1/2 top-20 z-30 h-0 -translate-x-1/2">
        <div className="flex justify-center gap-2 overflow-visible">
          <ShapeStyleFloatingControls />
          <TextFloatingControls />
          <LineTextFloatingControls />
          <RectangleTextFloatingControls />
        </div>
      </div>
      {pendingPortalCreation ? (
        <div className="fixed left-1/2 top-36 z-30 w-[360px] -translate-x-1/2 rounded-xl border border-slate-800 bg-slate-950/96 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Create portal
          </div>
          <div className="space-y-3">
            <div className="text-sm text-slate-300">
              New portals open into a larger destination. Choose where this one should point.
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                Destination
              </Label>
              <ButtonGroup className="w-full [&>[data-slot=button]]:flex-1">
                <Button
                  type="button"
                  size="sm"
                  variant={pendingPortalCreation.mode === "new-canvas" ? "secondary" : "outline"}
                  className="border-slate-800 bg-slate-950 text-slate-300 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-950"
                  data-selected={pendingPortalCreation.mode === "new-canvas"}
                  disabled={!canCreatePortalDocuments}
                  onClick={() =>
                    setPendingPortalCreation((current) =>
                      current ? { ...current, mode: "new-canvas" } : current,
                    )
                  }
                >
                  New canvas
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={pendingPortalCreation.mode === "same-canvas" ? "secondary" : "outline"}
                  className="border-slate-800 bg-slate-950 text-slate-300 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-950"
                  data-selected={pendingPortalCreation.mode === "same-canvas"}
                  onClick={() =>
                    setPendingPortalCreation((current) =>
                      current ? { ...current, mode: "same-canvas" } : current,
                    )
                  }
                >
                  This canvas
                </Button>
              </ButtonGroup>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-slate-300 hover:bg-slate-900"
                onClick={() => setPendingPortalCreation(null)}
                disabled={pendingPortalCreation.submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-slate-100 text-slate-950 hover:bg-white"
                onClick={() => void handleConfirmPortalCreation()}
                disabled={pendingPortalCreation.submitting}
              >
                {pendingPortalCreation.submitting ? "Creating…" : "Create portal"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {selectedPortalView ? (
        <div className="fixed left-1/2 top-36 z-30 w-[360px] -translate-x-1/2 rounded-xl border border-slate-800 bg-slate-950/96 p-3 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            {selectedPortalView.viewType === "component" ? "Component instance" : "Portal window"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-3 space-y-1">
              <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                Label
              </Label>
              <Input
                value={selectedPortalView.label}
                onChange={(event) =>
                  interactions.updatePortalView({
                    portalId: selectedPortalView.id,
                    changes: {
                      label: event.target.value,
                      updatedAt: new Date().toISOString(),
                    },
                  })
                }
                className="h-8 border-slate-800 bg-slate-950 text-slate-100"
              />
            </div>
            {selectedPortalView.viewType === "component" ? (
              <>
                <div className="col-span-3 space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Source component
                  </Label>
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 flex-1 items-center rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-300">
                      {selectedComponentDefinition?.name ?? selectedPortalView.label}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-amber-400/35 bg-slate-950 text-amber-100 hover:border-amber-300/65 hover:bg-slate-900"
                      onClick={() => onOpenPortalDestination?.({
                        portalId: selectedPortalView.id,
                        label: selectedPortalView.label,
                        sourceDocumentId: currentDocumentId === "__scratch__" ? null : currentDocumentId,
                        sourceCanvasId: activeCanvasId,
                        sourceRect: selectedPortalView.rect,
                        target: {
                          documentId: selectedPortalView.target.documentId,
                          canvasId: selectedPortalView.target.canvasId,
                          top: selectedPortalView.target.top,
                          left: selectedPortalView.target.left,
                          width: selectedPortalView.rect.width,
                          height: selectedPortalView.rect.height,
                        },
                      })}
                    >
                      Edit
                    </Button>
                  </div>
                </div>
                <div className="col-span-3 rounded-md border border-slate-800 bg-slate-950/75 px-3 py-2 text-xs text-slate-400">
                  Use attributes inside the source component with tokens like{" "}
                  {selectedComponentDefinition?.attributes.length ? (
                    selectedComponentDefinition.attributes.map((attribute, index) => (
                      <span key={attribute.key}>
                        {index > 0 ? ", " : ""}
                        <code className="rounded bg-slate-900 px-1 py-0.5 text-slate-100">{`{{${attribute.key}}}`}</code>
                      </span>
                    ))
                  ) : (
                    <span className="text-slate-300">no attributes yet</span>
                  )}
                  . Resize the instance to scale it without changing the source component.
                </div>
                <div className="col-span-3 grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                      Instance width
                    </Label>
                    <Input
                      value={String(selectedPortalView.rect.width)}
                      onChange={(event) => {
                        const nextWidth = Number.parseInt(event.target.value, 10);
                        if (!Number.isFinite(nextWidth)) return;
                        interactions.updatePortalView({
                          portalId: selectedPortalView.id,
                          changes: {
                            rect: {
                              ...selectedPortalView.rect,
                              width: Math.max(1, nextWidth),
                            },
                            updatedAt: new Date().toISOString(),
                          },
                        })
                      }}
                      className="h-8 border-slate-800 bg-slate-950 text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                      Instance height
                    </Label>
                    <Input
                      value={String(selectedPortalView.rect.height)}
                      onChange={(event) => {
                        const nextHeight = Number.parseInt(event.target.value, 10);
                        if (!Number.isFinite(nextHeight)) return;
                        interactions.updatePortalView({
                          portalId: selectedPortalView.id,
                          changes: {
                            rect: {
                              ...selectedPortalView.rect,
                              height: Math.max(1, nextHeight),
                            },
                            updatedAt: new Date().toISOString(),
                          },
                        })
                      }}
                      className="h-8 border-slate-800 bg-slate-950 text-slate-100"
                    />
                  </div>
                </div>
                {selectedComponentDefinition?.attributes.length ? (
                  selectedComponentDefinition.attributes.map((attribute) => (
                    <div key={attribute.key} className="col-span-3 space-y-1">
                      <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                        {attribute.key}
                      </Label>
                      <Input
                        value={selectedPortalView.componentProps?.[attribute.key] ?? attribute.defaultValue}
                        onChange={(event) =>
                          interactions.updatePortalView({
                            portalId: selectedPortalView.id,
                            changes: {
                              componentProps: {
                                ...(selectedPortalView.componentProps ?? {}),
                                [attribute.key]: event.target.value,
                              },
                              updatedAt: new Date().toISOString(),
                            },
                          })
                        }
                        className="h-8 border-slate-800 bg-slate-950 text-slate-100"
                      />
                    </div>
                  ))
                ) : (
                  <div className="col-span-3 rounded-md border border-dashed border-slate-800 px-3 py-2 text-xs text-slate-400">
                    This component has no defined attributes yet. Add them from the source component page.
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Source row
                  </Label>
                  <Input
                    value={String(selectedPortalView.target.top)}
                    onChange={(event) => {
                      const nextTop = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(nextTop)) return;
                      interactions.updatePortalView({
                        portalId: selectedPortalView.id,
                        changes: {
                          target: {
                            ...selectedPortalView.target,
                            top: Math.max(0, nextTop),
                          },
                          updatedAt: new Date().toISOString(),
                        },
                      });
                    }}
                    className="h-8 border-slate-800 bg-slate-950 text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Source col
                  </Label>
                  <Input
                    value={String(selectedPortalView.target.left)}
                    onChange={(event) => {
                      const nextLeft = Number.parseInt(event.target.value, 10);
                      if (!Number.isFinite(nextLeft)) return;
                      interactions.updatePortalView({
                        portalId: selectedPortalView.id,
                        changes: {
                          target: {
                            ...selectedPortalView.target,
                            left: Math.max(0, nextLeft),
                          },
                          updatedAt: new Date().toISOString(),
                        },
                      });
                    }}
                    className="h-8 border-slate-800 bg-slate-950 text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">
                    Canvas
                  </Label>
                  <div className="flex h-8 items-center rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-300">
                    This canvas
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      <ContextMenu
        open={canvasContextMenuOpen}
        onOpenChange={(open) => {
          setCanvasContextMenuOpen(open);
          if (!open) {
            setContextMenuSelectionIds([]);
          }
        }}
      >
        <ContextMenuTrigger className="contents">
          <div className="contents">
            <canvas
              ref={canvasRef}
              onContextMenuCapture={handleCanvasContextMenu}
              onMouseDown={(e) =>
                {
                  if (selectedFenceId) setSelectedFenceId(null);
                  if (selectedPortalViewId) setSelectedPortalViewId(null);
                handlePointerDown({
                    button: e.button,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    ctrlKey: e.ctrlKey,
                    metaKey: e.metaKey,
                    altKey: e.altKey,
                    shiftKey: e.shiftKey,
                    timeStamp: e.timeStamp,
                  });
                }
              }
              onMouseUp={(e) =>
                handlePointerUp({
                  button: e.button,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  ctrlKey: e.ctrlKey,
                  metaKey: e.metaKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                  timeStamp: e.timeStamp,
                })
              }
              onMouseMove={(e) => {
                if (pointerActiveRef.current) {
                  return;
                }
                handlePointerMove(getCellCoords(e.clientX, e.clientY), {
                  button: e.button,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  ctrlKey: e.ctrlKey,
                  metaKey: e.metaKey,
                  altKey: e.altKey,
                  shiftKey: e.shiftKey,
                  timeStamp: e.timeStamp,
                });
              }}
              onMouseLeave={(e) => {
                if (pointerActiveRef.current) {
                  return;
                }
                handleMouseLeave();
              }}
              onDoubleClick={(e) => {
                handleDoubleClick({
                  clientX: e.clientX,
                  clientY: e.clientY,
                });
              }}
            ></canvas>
            {selectedRectangleLabelInsertHandle ? (
              <button
                type="button"
                aria-label="Insert box label"
                title="Insert box label"
                className="pointer-events-auto absolute z-[9] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 border border-sky-400/45 bg-sky-400/10 shadow-[0_0_0_1px_rgba(56,189,248,0.14)] transition hover:border-sky-300/70 hover:bg-sky-400/18"
                style={{
                  top: selectedRectangleLabelInsertHandle.row * CELL_HEIGHT + CELL_HEIGHT * 0.5,
                  left: selectedRectangleLabelInsertHandle.col * CELL_WIDTH + CELL_WIDTH * 0.5,
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  interactions.beginRectangleLabelEdit(selectedRectangleLabelInsertHandle.shapeId);
                }}
              />
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <button
            type="button"
            disabled={!canCreateComponentFromSelection}
            className="group/context-menu-item relative flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-white outline-hidden select-none focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            onMouseDown={triggerCreateComponentFromContextSelection}
            onClick={triggerCreateComponentFromContextSelection}
          >
            Create component
          </button>
        </ContextMenuContent>
      </ContextMenu>
      {terminalPreview && terminalPreview.kind !== "info" && terminalPreview.canvasId === activeCanvasId ? (
        <div className="pointer-events-none absolute inset-0 z-[7]">
          {terminalPreview.kind === "point" ? (
            <div
              className="absolute"
              style={{
                top: terminalPreview.row * CELL_HEIGHT,
                left: terminalPreview.col * CELL_WIDTH,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="h-3 w-3 rounded-full border border-sky-200 bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.15)]" />
              <div className="absolute left-3 top-0 rounded-full border border-sky-400/40 bg-slate-950/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100 shadow-[0_10px_28px_rgba(0,0,0,0.32)] whitespace-nowrap">
                {terminalPreview.label}
              </div>
            </div>
          ) : null}
          {terminalPreview.kind === "rect" ? (
            <div
              className="absolute rounded-md border border-dashed border-sky-300/80 bg-sky-400/5"
              style={{
                top: terminalPreview.top * CELL_HEIGHT,
                left: terminalPreview.left * CELL_WIDTH,
                width: terminalPreview.width * CELL_WIDTH,
                height: terminalPreview.height * CELL_HEIGHT,
              }}
            >
              <div className="absolute left-2 top-2 rounded-full border border-sky-400/40 bg-slate-950/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100 shadow-[0_10px_28px_rgba(0,0,0,0.32)]">
                {terminalPreview.label}
              </div>
            </div>
          ) : null}
          {terminalPreview.kind === "line" ? (
            <div
              className="absolute"
              style={{
                top: Math.min(terminalPreview.from.row, terminalPreview.to.row) * CELL_HEIGHT,
                left: Math.min(terminalPreview.from.col, terminalPreview.to.col) * CELL_WIDTH,
                width:
                  (Math.abs(terminalPreview.to.col - terminalPreview.from.col) + 1) * CELL_WIDTH,
                height:
                  (Math.abs(terminalPreview.to.row - terminalPreview.from.row) + 1) * CELL_HEIGHT,
              }}
            >
              <svg className="absolute inset-0 overflow-visible">
                <line
                  x1={
                    terminalPreview.from.col <= terminalPreview.to.col
                      ? 0
                      : Math.abs(terminalPreview.to.col - terminalPreview.from.col) * CELL_WIDTH
                  }
                  y1={
                    terminalPreview.from.row <= terminalPreview.to.row
                      ? 0
                      : Math.abs(terminalPreview.to.row - terminalPreview.from.row) * CELL_HEIGHT
                  }
                  x2={
                    terminalPreview.from.col <= terminalPreview.to.col
                      ? Math.abs(terminalPreview.to.col - terminalPreview.from.col) * CELL_WIDTH
                      : 0
                  }
                  y2={
                    terminalPreview.from.row <= terminalPreview.to.row
                      ? Math.abs(terminalPreview.to.row - terminalPreview.from.row) * CELL_HEIGHT
                      : 0
                  }
                  stroke="rgba(125,211,252,0.95)"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              </svg>
              <div className="absolute left-2 top-2 rounded-full border border-sky-400/40 bg-slate-950/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-100 shadow-[0_10px_28px_rgba(0,0,0,0.32)] whitespace-nowrap">
                {terminalPreview.label}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {portalNavigationFocus && portalNavigationFocus.canvasId === activeCanvasId ? (
        <div
          className="absolute z-[8] rounded-md border border-white/60 bg-white/[0.03] shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
          style={{
            top: portalNavigationFocus.rect.top * CELL_HEIGHT,
            left: portalNavigationFocus.rect.left * CELL_WIDTH,
            width: portalNavigationFocus.rect.width * CELL_WIDTH,
            height: portalNavigationFocus.rect.height * CELL_HEIGHT,
          }}
        >
          <div className="pointer-events-none absolute left-2 top-2 rounded-full border border-white/12 bg-slate-950/92 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-100 shadow-[0_10px_28px_rgba(0,0,0,0.28)]">
            {portalNavigationFocus.label?.trim() || "Portal destination"}
          </div>
          {onDismissPortalNavigationFocus ? (
            <button
              type="button"
              aria-label="Dismiss portal destination"
              className="pointer-events-auto absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/12 bg-slate-950/92 text-slate-200 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-white/30 hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismissPortalNavigationFocus();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <CanvasPortalViewLayer
        activeCanvasId={activeCanvasId}
        portalViews={renderedPortalViews}
        selectedPortalViewId={selectedPortalViewId}
        onSelectPortalView={setSelectedPortalViewId}
        onOpenPortalView={(portalViewId) => {
          const portalView = renderedPortalViews.find((entry) => entry.id === portalViewId);
          if (!portalView || !onOpenPortalDestination) return;
          onOpenPortalDestination({
            portalId: portalView.id,
            label: portalView.label,
            sourceDocumentId: currentDocumentId === "__scratch__" ? null : currentDocumentId,
            sourceCanvasId: activeCanvasId,
            sourceRect: portalView.rect,
            target: {
              documentId: portalView.target.documentId,
              canvasId: portalView.target.canvasId,
              top: portalView.target.top,
              left: portalView.target.left,
              width: portalView.rect.width,
              height: portalView.rect.height,
            },
          });
        }}
        onStartMovePortalView={({ portalViewId, clientX, clientY }) => {
          const portalView = renderedPortalViews.find((entry) => entry.id === portalViewId);
          if (!portalView) return;
          portalViewEditSessionRef.current = {
            kind: "move",
            portalId: portalViewId,
            startClientX: clientX,
            startClientY: clientY,
            initialRect: portalView.rect,
          };
          setPortalViewTransientRect({
            portalViewId,
            rect: portalView.rect,
          });
        }}
        onStartResizePortalView={({ portalViewId, handle, clientX, clientY }) => {
          const portalView = renderedPortalViews.find((entry) => entry.id === portalViewId);
          if (!portalView) return;
          portalViewEditSessionRef.current = {
            kind: "resize",
            portalId: portalViewId,
            handle,
            startClientX: clientX,
            startClientY: clientY,
            initialRect: portalView.rect,
          };
          setPortalViewTransientRect({
            portalViewId,
            rect: portalView.rect,
          });
        }}
        onDeletePortalView={(portalViewId) => {
          setSelectedPortalViewId((current) => (current === portalViewId ? null : current));
          interactions.deletePortalView(portalViewId);
        }}
      />
      <CanvasOverlayLayer
        activeCanvasId={activeCanvasId}
        portals={renderedPortals as CanvasResolvedPortalAccess[]}
        collaborators={overlayCollaborators}
        collaboratorPortalDrafts={collaboratorPortalDrafts}
        portalDraftBounds={portalDraftBounds}
        selectedPortalId={selectedFenceId}
        canManagePortals={canManagePortals}
        hoveredBindingLockTarget={hoveredBindingLockTarget}
        onToggleBindingLock={interactions.toggleBindingLock}
        onSelectPortal={setSelectedFenceId}
        onStartMovePortal={
          canManagePortals
            ? ({ portalId, clientX, clientY }) => {
                const portal = renderedPortals.find((entry) => entry.id === portalId);
                if (!portal) return;
                portalEditSessionRef.current = {
                  kind: "move",
                  portalId,
                  startClientX: clientX,
                  startClientY: clientY,
                  initialRect: portal.rect,
                };
                setPortalTransientRect({
                  fenceId: portalId,
                  rect: portal.rect,
                });
              }
            : undefined
        }
        onStartResizePortal={
          canManagePortals
            ? ({ portalId, handle, clientX, clientY }) => {
                const portal = renderedPortals.find((entry) => entry.id === portalId);
                if (!portal) return;
                portalEditSessionRef.current = {
                  kind: "resize",
                  portalId,
                  handle,
                  startClientX: clientX,
                  startClientY: clientY,
                  initialRect: portal.rect,
                };
                setPortalTransientRect({
                  fenceId: portalId,
                  rect: portal.rect,
                });
              }
            : undefined
        }
        onDeletePortal={
          canManagePortals
            ? (portalId) => {
                setSelectedFenceId((current) => (current === portalId ? null : current));
                onDeleteFence?.(portalId);
              }
            : undefined
        }
        onOpenPortalShare={canManagePortals ? onOpenFenceShare : undefined}
      />
      {currentEditedText && (
        <TextShapeInput
          // Add key, in order to force React to recreate a new instance when edit a new text object
          key={
            mode.M === "TEXT_EDIT" ||
            mode.M === "RECTANGLE_TEXT_EDIT" ||
            mode.M === "RECTANGLE_LABEL_EDIT" ||
            mode.M === "LINE_TEXT_EDIT"
              ? `textinput_${mode.M}_${mode.shapeId}`
              : `textinput_r${currentEditedText.start.r}_c${currentEditedText.start.c}`
          }
        />
      )}
    </div>
  );
}
