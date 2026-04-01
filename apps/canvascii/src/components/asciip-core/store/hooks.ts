import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "./store";
import { editorInteractionActions } from "./editorInteractionActions";
import type { Coords } from "../models/shapes";
import type { Style, StyleMode } from "../models/style";
import type { Tool } from "./diagramSlice";
import type { CanvasPortalView } from "@/lib/canvascii/live-portals";

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

export function useEditorInteractions() {
  const dispatch = useAppDispatch();

  return useMemo(() => ({
    pointerHover: (coords: Coords) => dispatch(editorInteractionActions.pointerHover(coords)),
    pointerDown: (payload: { coords: Coords; duplicate?: boolean; shiftKey?: boolean }) =>
      dispatch(editorInteractionActions.pointerDown(payload)),
    pointerUp: (coords: Coords) => dispatch(editorInteractionActions.pointerUp(coords)),
    pointerClick: (payload: { coords: Coords; ctrlKey?: boolean; shiftKey?: boolean }) =>
      dispatch(editorInteractionActions.pointerClick(payload)),
    pointerDoubleClick: (coords: Coords) =>
      dispatch(editorInteractionActions.pointerDoubleClick(coords)),
    pointerLeave: () => dispatch(editorInteractionActions.pointerLeave()),
    consumePendingCanvasScroll: () =>
      dispatch(editorInteractionActions.consumePendingCanvasScroll()),
    enableMoveDuplication: () =>
      dispatch(editorInteractionActions.enableMoveDuplication()),
    setTool: (tool: Tool) => dispatch(editorInteractionActions.setTool(tool)),
    addPortalView: (portal: CanvasPortalView) => dispatch(editorInteractionActions.addPortalView(portal)),
    updatePortalView: (payload: { portalId: string; changes: Partial<CanvasPortalView> }) =>
      dispatch(editorInteractionActions.updatePortalView(payload)),
    deletePortalView: (portalId: string) => dispatch(editorInteractionActions.deletePortalView(portalId)),
    updateText: (value: string) => dispatch(editorInteractionActions.updateText(value)),
    applyCommittedTextTransform: (value: string) =>
      dispatch(editorInteractionActions.applyCommittedTextTransform(value)),
    setTextCursor: (coords: Coords | null) =>
      dispatch(editorInteractionActions.setTextCursor(coords)),
    completeTextInput: () =>
      dispatch(editorInteractionActions.completeTextInput()),
    alignSelectedText: (align: "LEFT" | "CENTER" | "RIGHT") =>
      dispatch(editorInteractionActions.alignSelectedText(align)),
    encloseSelectedText: () =>
      dispatch(editorInteractionActions.encloseSelectedText()),
    completePolyline: () =>
      dispatch(editorInteractionActions.completePolyline()),
    toggleBindingLock: (payload: { shapeId: string; endpoint: "START" | "END" }) =>
      dispatch(editorInteractionActions.toggleBindingLock(payload)),
    exitInteractionMode: () =>
      dispatch(editorInteractionActions.exitInteractionMode()),
    deleteSelection: () =>
      dispatch(editorInteractionActions.deleteSelection()),
    cycleSelection: (direction: "NEXT" | "PREVIOUS") =>
      dispatch(editorInteractionActions.cycleSelection(direction)),
    selectAll: () => dispatch(editorInteractionActions.selectAll()),
    copySelection: () => dispatch(editorInteractionActions.copySelection()),
    pasteClipboard: () => dispatch(editorInteractionActions.pasteClipboard()),
    moveInHistory: (direction: "UNDO" | "REDO") =>
      dispatch(editorInteractionActions.moveInHistory(direction)),
    setStyleMode: (mode: StyleMode) =>
      dispatch(editorInteractionActions.setStyleMode(mode)),
    setStyle: (payload: { style: Partial<Style>; shapeIds?: string[] }) =>
      dispatch(editorInteractionActions.setStyle(payload)),
    moveSelectionToFront: () =>
      dispatch(editorInteractionActions.moveSelectionToFront()),
    moveSelectionToBack: () =>
      dispatch(editorInteractionActions.moveSelectionToBack()),
    groupSelection: () => dispatch(editorInteractionActions.groupSelection()),
    ungroupSelection: () => dispatch(editorInteractionActions.ungroupSelection()),
    expandCanvas: () => dispatch(editorInteractionActions.expandCanvas()),
    shrinkCanvasToFit: () =>
      dispatch(editorInteractionActions.shrinkCanvasToFit()),
    openExport: () => dispatch(editorInteractionActions.openExport()),
    closeExport: () => dispatch(editorInteractionActions.closeExport()),
    beginRectangleLabelEdit: (shapeId: string) =>
      dispatch(editorInteractionActions.beginRectangleLabelEdit(shapeId)),
  }), [dispatch]);
}
