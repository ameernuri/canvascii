import { useEffect, useRef, useState } from "react";
import _ from "lodash";
import { normalizeTlBr, type Coords } from "../../models/shapes";
import { CELL_HEIGHT, CELL_WIDTH } from "./draw";
import { resolveCanvasAccessAtPoint, type CanvasAccessSummary } from "@canvascii/core";
import type { ActionMode } from "../../store/diagramSlice";

type PointerInput = {
  button: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
};

type PortalBounds = {
  top: number;
  left: number;
  width: number;
  height: number;
} | null;

type CreationSession =
  | {
      kind: "fence" | "portal";
      start: Coords;
    }
  | null;

export function useCanvasInteractionController({
  activeCanvasId,
  accessSummary,
  canReadOnlyBlock,
  isPanToolActive,
  mode,
  selectedTool,
  pendingCanvasScroll,
  onConsumePendingCanvasScroll,
  onPointerDown,
  onPointerHover,
  onPointerUp,
  onPointerClick,
  onPointerDoubleClick,
  onPointerLeave,
  onEnableMoveDuplication,
  onCreateFenceFromBounds,
  onFenceCreated,
  onCreatePortalViewFromBounds,
  onPortalViewCreated,
  mapInteractionCoords,
}: {
  activeCanvasId: string;
  accessSummary?: CanvasAccessSummary | null;
  canReadOnlyBlock: boolean;
  isPanToolActive: boolean;
  mode: ActionMode;
  selectedTool: string;
  pendingCanvasScroll: Coords | null;
  onConsumePendingCanvasScroll: () => void;
  onPointerDown: (payload: {
    coords: Coords;
    duplicate?: boolean;
    shiftKey?: boolean;
  }) => void;
  onPointerHover: (coords: Coords) => void;
  onPointerUp: (coords: Coords) => void;
  onPointerClick: (payload: {
    coords: Coords;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }) => void;
  onPointerDoubleClick: (coords: Coords) => void;
  onPointerLeave: () => void;
  onEnableMoveDuplication: () => void;
  onCreateFenceFromBounds?: (bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => Promise<void>;
  onFenceCreated?: () => void;
  onCreatePortalViewFromBounds?: (bounds: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => void;
  onPortalViewCreated?: () => void;
  mapInteractionCoords?: (coords: Coords) => Coords;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerActiveRef = useRef(false);
  const hoveredCellRef = useRef<Coords | null>(null);
  const panSessionRef = useRef<{
    pointerX: number;
    pointerY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const pendingMouseDown = useRef<{
    timestamp: number;
    cell: Coords;
    timeoutId: number | null;
    pendingMoveActions: Coords[];
    duplicate: boolean;
    shiftKey: boolean;
  } | null>(null);
  const portalCreationSessionRef = useRef<CreationSession>(null);
  const [portalDraftBounds, setPortalDraftBounds] = useState<PortalBounds>(null);

  const getCellCoords = (eventX: number, eventY: number): Coords => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      r: Math.floor((eventY - rect.top) / CELL_HEIGHT),
      c: Math.floor((eventX - rect.left) / CELL_WIDTH),
    };
  };

  const canEditAtCoords = (coords: Coords): boolean => {
    if (!accessSummary) return true;
    const access = resolveCanvasAccessAtPoint(accessSummary, activeCanvasId, {
      row: coords.r,
      col: coords.c,
    });
    return access === "edit" || access === "owner";
  };

  const clearPendingMouseDown = () => {
    if (pendingMouseDown.current?.timeoutId != null) {
      window.clearTimeout(pendingMouseDown.current.timeoutId);
    }
    pendingMouseDown.current = null;
  };

  const clearPanSession = () => {
    panSessionRef.current = null;
  };

  const isClickFirstPathTool = selectedTool === "MULTI_SEGMENT_LINE";
  const isFenceToolActive = selectedTool === "FENCE" && Boolean(onCreateFenceFromBounds);
  const isPortalToolActive = selectedTool === "PORTAL" && Boolean(onCreatePortalViewFromBounds);

  const toPortalBounds = (start: Coords, end: Coords) => {
    const [tl, br] = normalizeTlBr(start, end);
    return {
      top: tl.r,
      left: tl.c,
      width: br.c - tl.c + 1,
      height: br.r - tl.r + 1,
    };
  };

  const dispatchHoverIfChanged = (coords: Coords) => {
    if (_.isEqual(hoveredCellRef.current, coords)) {
      return;
    }
    hoveredCellRef.current = coords;
    onPointerHover(coords);
  };

  const resolveCoords = (coords: Coords) => mapInteractionCoords?.(coords) ?? coords;

  const handlePointerDown = (input: PointerInput) => {
    if (input.button !== 0) {
      return;
    }
    pointerActiveRef.current = true;

    if (isPanToolActive) {
      const container = containerRef.current;
      if (!container) return;
      clearPendingMouseDown();
      panSessionRef.current = {
        pointerX: input.clientX,
        pointerY: input.clientY,
        scrollLeft: container.scrollLeft,
        scrollTop: container.scrollTop,
      };
      return;
    }

    const rawCoords = getCellCoords(input.clientX, input.clientY);
    const coords = resolveCoords(rawCoords);
    if (canReadOnlyBlock || !canEditAtCoords(coords)) {
      dispatchHoverIfChanged(coords);
      return;
    }

    if (isFenceToolActive || isPortalToolActive) {
      clearPendingMouseDown();
      portalCreationSessionRef.current = {
        kind: isFenceToolActive ? "fence" : "portal",
        start: rawCoords,
      };
      setPortalDraftBounds(toPortalBounds(rawCoords, rawCoords));
      return;
    }

    const duplicate = input.metaKey || input.ctrlKey || input.altKey;
    const shiftKey = input.shiftKey;

    if (isClickFirstPathTool) {
      pendingMouseDown.current = {
        timestamp: input.timeStamp,
        cell: coords,
        timeoutId: null,
        pendingMoveActions: [],
        duplicate,
        shiftKey,
      };
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const pending = pendingMouseDown.current;
      onPointerDown({
        coords,
        duplicate: pending?.duplicate ?? duplicate,
        shiftKey: pending?.shiftKey ?? shiftKey,
      });
      if (pendingMouseDown.current) {
        pendingMouseDown.current.pendingMoveActions.forEach((moveCoords) =>
          dispatchHoverIfChanged(moveCoords),
        );
      }
      pendingMouseDown.current = null;
    }, 150);

    pendingMouseDown.current = {
      timestamp: input.timeStamp,
      cell: coords,
      timeoutId,
      pendingMoveActions: [],
      duplicate,
      shiftKey,
    };
  };

  const handlePointerMove = (coords: Coords, input: PointerInput) => {
    if (isPanToolActive) {
      const container = containerRef.current;
      const panSession = panSessionRef.current;
      if (!container || !panSession) return;
      container.scrollLeft = panSession.scrollLeft - (input.clientX - panSession.pointerX);
      container.scrollTop = panSession.scrollTop - (input.clientY - panSession.pointerY);
      return;
    }

    if (portalCreationSessionRef.current) {
      setPortalDraftBounds(toPortalBounds(portalCreationSessionRef.current.start, coords));
      return;
    }

    const duplicateModifierPressed = input.metaKey || input.ctrlKey || input.altKey;
    if (pendingMouseDown.current) {
      if (canReadOnlyBlock || !canEditAtCoords(coords)) {
        if (mode.M === "CREATE" || mode.M === "MOVE" || mode.M === "RESIZE") {
          dispatchHoverIfChanged(coords);
          return;
        }
      }

      if (duplicateModifierPressed) {
        pendingMouseDown.current.duplicate = true;
      }

      const { pendingMoveActions } = pendingMouseDown.current;
      if (pendingMoveActions.length === 0) {
        if (!_.isEqual(hoveredCellRef.current, coords)) {
          pendingMoveActions.push(coords);
        }
      } else if (!_.isEqual(_.last(pendingMoveActions), coords)) {
        pendingMouseDown.current.pendingMoveActions.push(coords);
      }

      return;
    }

    if (mode.M === "MOVE" && duplicateModifierPressed) {
      onEnableMoveDuplication();
    }
    dispatchHoverIfChanged(resolveCoords(coords));
  };

  const handlePointerUp = (input: PointerInput) => {
    if (input.button !== 0) {
      return;
    }
    pointerActiveRef.current = false;
    if (isPanToolActive) {
      clearPanSession();
      return;
    }

    const rawCoords = getCellCoords(input.clientX, input.clientY);
    const coords = resolveCoords(rawCoords);
    if (canReadOnlyBlock || !canEditAtCoords(coords)) {
      clearPendingMouseDown();
      portalCreationSessionRef.current = null;
      setPortalDraftBounds(null);
      return;
    }

    if (portalCreationSessionRef.current) {
      const creationSession = portalCreationSessionRef.current;
      const bounds = toPortalBounds(creationSession.start, rawCoords);
      portalCreationSessionRef.current = null;
      if (bounds.width > 1 && bounds.height > 1 && creationSession.kind === "fence" && onCreateFenceFromBounds) {
        setPortalDraftBounds(bounds);
        onFenceCreated?.();
        void onCreateFenceFromBounds(bounds).finally(() => {
          setPortalDraftBounds(null);
        });
      } else if (
        bounds.width > 1 &&
        bounds.height > 1 &&
        creationSession.kind === "portal" &&
        onCreatePortalViewFromBounds
      ) {
        onPortalViewCreated?.();
        onCreatePortalViewFromBounds(bounds);
        setPortalDraftBounds(null);
      } else {
        setPortalDraftBounds(null);
      }
      return;
    }

    if (pendingMouseDown.current) {
      const pending = pendingMouseDown.current;
      if (pending.timeoutId != null) {
        window.clearTimeout(pending.timeoutId);
        pending.pendingMoveActions.forEach((moveCoords) => dispatchHoverIfChanged(moveCoords));
      }
      if (isClickFirstPathTool) {
        dispatchHoverIfChanged(coords);
      }
      onPointerClick({
        coords,
        ctrlKey: input.ctrlKey || input.metaKey,
        shiftKey: input.shiftKey,
      });
      pendingMouseDown.current = null;
      return;
    }

    onPointerUp(coords);
  };

  const handleMouseLeave = () => {
    if (pointerActiveRef.current) return;
    hoveredCellRef.current = null;
    clearPendingMouseDown();
    clearPanSession();
    portalCreationSessionRef.current = null;
    setPortalDraftBounds(null);
    onPointerLeave();
  };

  const handleDoubleClick = (input: { clientX: number; clientY: number }) => {
    if (isPanToolActive) return;
    const coords = resolveCoords(getCellCoords(input.clientX, input.clientY));
    if (canReadOnlyBlock || !canEditAtCoords(coords)) return;
    onPointerDoubleClick(coords);
  };

  useEffect(() => {
    if (!pendingCanvasScroll || !containerRef.current) {
      return;
    }
    containerRef.current.scrollLeft += pendingCanvasScroll.c * CELL_WIDTH;
    containerRef.current.scrollTop += pendingCanvasScroll.r * CELL_HEIGHT;
    onConsumePendingCanvasScroll();
  }, [onConsumePendingCanvasScroll, pendingCanvasScroll]);

  useEffect(() => {
    if (!isFenceToolActive && !isPortalToolActive && portalDraftBounds) {
      portalCreationSessionRef.current = null;
      setPortalDraftBounds(null);
    }
  }, [isFenceToolActive, isPortalToolActive, portalDraftBounds]);

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      if (!pointerActiveRef.current) return;
      handlePointerMove(getCellCoords(event.clientX, event.clientY), {
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        timeStamp: event.timeStamp,
      });
    };

    const handleWindowMouseUp = (event: MouseEvent) => {
      if (!pointerActiveRef.current) return;
      handlePointerUp({
        button: event.button,
        clientX: event.clientX,
        clientY: event.clientY,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        timeStamp: event.timeStamp,
      });
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return {
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
  };
}
