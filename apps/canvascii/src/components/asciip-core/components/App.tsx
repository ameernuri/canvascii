import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Toolbar from "./toolbar/Toolbar";
import Canvas from "./canvas/Canvas";
import { useAppDispatch, useAppSelector, useEditorInteractions } from "../store/hooks";
import { selectors } from "../store/selectors";
import { editorTheme } from "../theme";
import { getTextExport } from "../models/representation";
import { getBoundingBoxOfAll } from "../models/shapeInCanvas";
import type { EditorCollaborationProps, EditorTerminalPreview } from "@/lib/canvascii/collaboration";
import type { ShapeObject } from "../store/diagramSlice";
import { appActions } from "../store/appSlice";

function areCanvasRectsEqual(
  a: { top: number; left: number; width: number; height: number } | null,
  b: { top: number; left: number; width: number; height: number } | null,
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function App({
  currentDocumentId,
  toolbarLeading,
  toolbarFullscreen,
  toolbarTrailing,
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
  terminalPreview,
  onRequestCreateComponentFromSelection,
  showHistory,
  focusPoint,
  showCollaboratorOverlays,
}: {
  currentDocumentId: string;
  toolbarLeading?: ReactNode;
  toolbarFullscreen?: ReactNode;
  toolbarTrailing?: ReactNode;
  currentCollaboratorName?: string | null;
  portalMirrorConfig?: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  };
  onPortalMirrorConfigChange?: (next: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  }) => void;
  accessSummary?: EditorCollaborationProps["accessSummary"];
  collaborators?: EditorCollaborationProps["collaborators"];
  canManagePortals?: EditorCollaborationProps["canManagePortals"];
  onEditorMetaChange?: EditorCollaborationProps["onEditorMetaChange"];
  onCreateFenceFromBounds?: EditorCollaborationProps["onCreateFenceFromBounds"];
  onUpdateFence?: EditorCollaborationProps["onUpdateFence"];
  onDeleteFence?: EditorCollaborationProps["onDeleteFence"];
  onOpenFenceShare?: EditorCollaborationProps["onOpenFenceShare"];
  onFenceDraftBoundsChange?: EditorCollaborationProps["onFenceDraftBoundsChange"];
  canCreatePortalDocuments?: EditorCollaborationProps["canCreatePortalDocuments"];
  onResolvePortalTarget?: EditorCollaborationProps["onResolvePortalTarget"];
  onOpenPortalDestination?: EditorCollaborationProps["onOpenPortalDestination"];
  portalTargetShapeMap?: EditorCollaborationProps["portalTargetShapeMap"];
  componentDefinitionMap?: EditorCollaborationProps["componentDefinitionMap"];
  portalNavigationFocus?: EditorCollaborationProps["portalNavigationFocus"];
  onPortalNavigationFocusHandled?: EditorCollaborationProps["onPortalNavigationFocusHandled"];
  onDismissPortalNavigationFocus?: EditorCollaborationProps["onDismissPortalNavigationFocus"];
  terminalPreview?: EditorTerminalPreview | null;
  onRequestCreateComponentFromSelection?: EditorCollaborationProps["onRequestCreateComponentFromSelection"];
  showHistory?: boolean;
  focusPoint?: {
    row: number;
    col: number;
    key: string;
  } | null;
  showCollaboratorOverlays?: boolean;
}) {
  const dispatch = useAppDispatch();
  const interactions = useEditorInteractions();

  const shortcutsEnabled = useAppSelector((state) =>
    selectors.isShortcutsEnabled(state)
  );
  const activeCanvasId = useAppSelector((state) => state.app.activeDiagramId);
  const diagramIds = useAppSelector((state) => selectors.diagramIds(state));
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const canvasSize = useAppSelector((state) => state.diagram.canvasSize);
  const currentHoveredCell = useAppSelector((state) => state.diagram.currentHoveredCell);
  const textCursorCell = useAppSelector((state) => state.diagram.textCursorCell);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const mode = useAppSelector((state) => state.diagram.mode);
  const currentCreatedShape = useAppSelector((state) =>
    selectors.currentCreatedShape(state.diagram)
  );
  const currentEditedText = useAppSelector((state) =>
    selectors.currentEditedText(state.diagram)
  );
  const shapeObjs = useAppSelector((state) => state.diagram.shapes);
  const selectedShapeObjs = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );
  const collaborationDraftObjects = useMemo(
    () =>
      mode.M === "MOVE" || mode.M === "RESIZE" || mode.M === "RESIZE_MULTI"
        ? selectedShapeObjs.map((shapeObj) => ({
            id: shapeObj.id,
            shape: JSON.parse(JSON.stringify(shapeObj.shape)) as Record<string, unknown>,
            style: shapeObj.style
              ? (JSON.parse(JSON.stringify(shapeObj.style)) as Record<string, unknown>)
              : null,
          }))
        : null,
    [mode.M, selectedShapeObjs],
  );
  const selectedBounds = useMemo(
    () => getBoundingBoxOfAll(selectedShapeObjs.map((shapeObj) => shapeObj.shape)),
    [selectedShapeObjs]
  );
  const isReadOnly = Boolean(accessSummary && !accessSummary.canEditSomewhere);
  const [portalDraftBounds, setPortalDraftBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [viewportBounds, setViewportBounds] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const handlePortalDraftBoundsChange = useCallback(
    (
      bounds: {
        top: number;
        left: number;
        width: number;
        height: number;
      } | null
    ) => {
      setPortalDraftBounds((current) => (areCanvasRectsEqual(current, bounds) ? current : bounds));
      onFenceDraftBoundsChange?.(bounds);
    },
    [onFenceDraftBoundsChange]
  );

  const handleViewportBoundsChange = useCallback(
    (
      bounds: {
        top: number;
        left: number;
        width: number;
        height: number;
      } | null
    ) => {
      setViewportBounds((current) => (areCanvasRectsEqual(current, bounds) ? current : bounds));
    },
    []
  );

  useEffect(() => {
    if (!portalNavigationFocus) return;
    if (portalNavigationFocus.canvasId === activeCanvasId) return;
    if (!diagramIds.includes(portalNavigationFocus.canvasId)) return;
    dispatch(appActions.setActiveDiagram(portalNavigationFocus.canvasId));
  }, [activeCanvasId, diagramIds, dispatch, portalNavigationFocus]);

  useEffect(() => {
    const collaborationDraftShape = currentCreatedShape ?? currentEditedText ?? null;
    onEditorMetaChange?.({
      activeCanvasId,
      activeTool: selectedTool,
      selectedObjectIds: selectedShapeObjs.map((shapeObj) => shapeObj.id),
      hoveredCell: currentHoveredCell
        ? { row: currentHoveredCell.r, col: currentHoveredCell.c }
        : null,
      textCursorCell: textCursorCell
        ? { row: textCursorCell.r, col: textCursorCell.c }
        : null,
      selectedBounds: selectedBounds
        ? {
            top: selectedBounds.top,
            left: selectedBounds.left,
            width: selectedBounds.right - selectedBounds.left + 1,
            height: selectedBounds.bottom - selectedBounds.top + 1,
          }
        : null,
      canvasSize,
      viewportBounds,
      draftShape: collaborationDraftShape
        ? (JSON.parse(JSON.stringify(collaborationDraftShape)) as Record<string, unknown>)
        : null,
      draftObjects: collaborationDraftObjects,
      draftStyleMode: collaborationDraftShape || collaborationDraftObjects ? styleMode : null,
      draftStyle: collaborationDraftShape || collaborationDraftObjects
        ? (JSON.parse(JSON.stringify(globalStyle)) as Record<string, unknown>)
        : null,
      draftPortalBounds: portalDraftBounds,
    });
  }, [
    activeCanvasId,
    canvasSize,
    collaborationDraftObjects,
    currentCreatedShape,
    currentEditedText,
    currentHoveredCell,
    textCursorCell,
    globalStyle,
    mode.M,
    onEditorMetaChange,
    portalDraftBounds,
    viewportBounds,
    selectedBounds,
    selectedTool,
    styleMode,
  ]);

  useEffect(() => {
    const isTypingTarget = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      return (
        target.isContentEditable ||
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT"
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.ctrlKey || event.metaKey;
      const typingTarget = isTypingTarget(event);

        if (isReadOnly && !hasPrimaryModifier) {
          return;
        }

      if (event.key === "Escape") {
        event.preventDefault();
        interactions.exitInteractionMode();
      } else if (event.key === "Enter" && event.metaKey) {
        event.preventDefault();
        interactions.completeTextInput();
      } else if (event.key === "Enter" && event.ctrlKey) {
        interactions.completeTextInput();
      } else if (event.key === "Enter" && !hasPrimaryModifier && !typingTarget) {
        event.preventDefault();
        interactions.completePolyline();
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !isTypingTarget(event)
      ) {
        if (event.key === "Backspace") event.preventDefault();
        interactions.deleteSelection();
      } else if (event.key === "Tab" && !typingTarget) {
        event.preventDefault();
        interactions.cycleSelection(event.shiftKey ? "PREVIOUS" : "NEXT");
      } else if (
        (event.key === "a" || event.key === "A") &&
        hasPrimaryModifier &&
        !typingTarget
      ) {
        event.preventDefault();
        interactions.selectAll();
      }

      if (shortcutsEnabled && !typingTarget) {
        if (event.key === " " && !hasPrimaryModifier) {
          event.preventDefault();
          interactions.setTool("PAN");
        } else if (
          (event.key === "s" || event.key === "S" || event.key === "v" || event.key === "V") &&
          !hasPrimaryModifier
        ) {
          interactions.setTool("SELECT");
        } else if ((event.key === "r" || event.key === "R") && !hasPrimaryModifier) {
          interactions.setTool("RECTANGLE");
        } else if ((event.key === "l" || event.key === "L") && !hasPrimaryModifier) {
          interactions.setTool("LINE");
          interactions.setStyle({
            style: { arrowStartHead: false, arrowEndHead: false },
          });
        } else if ((event.key === "a" || event.key === "A") && !hasPrimaryModifier) {
          interactions.setTool("LINE");
          interactions.setStyle({
            style: { arrowStartHead: false, arrowEndHead: true },
          });
        } else if (
          (event.key === "p" || event.key === "P" || event.key === "w" || event.key === "W") &&
          !hasPrimaryModifier
        ) {
          interactions.setTool("MULTI_SEGMENT_LINE");
        } else if ((event.key === "o" || event.key === "O") && !hasPrimaryModifier && canManagePortals) {
          interactions.setTool("FENCE");
        } else if ((event.key === "g" || event.key === "G") && !hasPrimaryModifier && !isReadOnly) {
          interactions.setTool("PORTAL");
        } else if ((event.key === "t" || event.key === "T") && !hasPrimaryModifier) {
          interactions.setTool("TEXT");
        } else if ((event.key === "x" || event.key === "X") && !hasPrimaryModifier) {
          if (
            selectedShapeObjs.length > 0 &&
            selectedShapeObjs.every((shapeObj) => shapeObj.shape.type === "RECTANGLE")
          ) {
            event.preventDefault();
            const fills = selectedShapeObjs.map(
              (shapeObj) => shapeObj.style?.rectangleFill ?? globalStyle.rectangleFill
            );
            const uniqueFills = Array.from(new Set(fills));
            const nextFill =
              uniqueFills.length === 1
                ? uniqueFills[0] === "SOLID"
                  ? "NONE"
                  : "SOLID"
                : "SOLID";
            interactions.setStyle({
              style: { rectangleFill: nextFill },
              shapeIds: selectedShapeObjs.map((shapeObj) => shapeObj.id),
            });
          }
        } else if (
          (event.key === "c" || event.key === "C") &&
          hasPrimaryModifier &&
          event.shiftKey
        ) {
          event.preventDefault();
          const selectedIdSet = new Set(selectedShapeObjs.map((shapeObj) => shapeObj.id));
          const selectedShapes = shapeObjs.filter((shapeObj) =>
            selectedIdSet.has(shapeObj.id)
          );
          if (selectedShapes.length > 0) {
            const selectionText = getTextExport(
              selectedShapes,
              { styleMode, globalStyle },
              "NONE"
            );
            void navigator.clipboard.writeText(selectionText);
          }
        } else if ((event.key === "c" || event.key === "C") && hasPrimaryModifier) {
          event.preventDefault();
          interactions.copySelection();
        } else if ((event.key === "v" || event.key === "V") && hasPrimaryModifier) {
          event.preventDefault();
          interactions.pasteClipboard();
        } else if ((event.key === "z" || event.key === "Z") && hasPrimaryModifier) {
          event.preventDefault();
          if (event.shiftKey) {
            interactions.moveInHistory("REDO");
          } else {
            interactions.moveInHistory("UNDO");
          }
        } else if ((event.key === "y" || event.key === "Y") && event.ctrlKey) {
          event.preventDefault();
          interactions.moveInHistory("REDO");
        }
      }
    };

    const handleKeyUp = (_event: KeyboardEvent) => {};

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    globalStyle,
    globalStyle.rectangleFill,
    interactions,
    selectedShapeObjs,
    shapeObjs,
    shortcutsEnabled,
    styleMode,
    isReadOnly,
    canManagePortals,
    isReadOnly,
  ]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
        width: "100%",
        background: editorTheme.chrome.background,
        color: editorTheme.chrome.text,
      }}
    >
      <Toolbar
        leadingContent={toolbarLeading}
        fullscreenContent={toolbarFullscreen}
        trailingContent={toolbarTrailing}
        canCreateFence={Boolean(canManagePortals)}
        canCreatePortal={!isReadOnly}
        showHistory={showHistory}
      />
        <Canvas
          currentDocumentId={currentDocumentId}
          currentCollaboratorName={currentCollaboratorName}
          portalMirrorConfig={portalMirrorConfig}
          onPortalMirrorConfigChange={onPortalMirrorConfigChange}
          accessSummary={accessSummary}
        collaborators={collaborators}
        canManagePortals={canManagePortals}
        onCreateFenceFromBounds={onCreateFenceFromBounds}
        onUpdateFence={onUpdateFence}
        onDeleteFence={onDeleteFence}
        onOpenFenceShare={onOpenFenceShare}
        onFenceDraftBoundsChange={handlePortalDraftBoundsChange}
        canCreatePortalDocuments={canCreatePortalDocuments}
        onResolvePortalTarget={onResolvePortalTarget}
        onOpenPortalDestination={onOpenPortalDestination}
        portalTargetShapeMap={portalTargetShapeMap as Record<string, ShapeObject[]> | undefined}
        componentDefinitionMap={componentDefinitionMap}
        portalNavigationFocus={portalNavigationFocus}
        onPortalNavigationFocusHandled={onPortalNavigationFocusHandled}
        onDismissPortalNavigationFocus={onDismissPortalNavigationFocus}
        terminalPreview={terminalPreview}
        onViewportBoundsChange={handleViewportBoundsChange}
        onRequestCreateComponentFromSelection={onRequestCreateComponentFromSelection}
        focusPoint={focusPoint}
        showCollaboratorOverlays={showCollaboratorOverlays}
      />
    </div>
  );
}

export default App;
