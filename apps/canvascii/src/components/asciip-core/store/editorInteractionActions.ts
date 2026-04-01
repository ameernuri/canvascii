import { createAction } from "@reduxjs/toolkit";
import type { Coords } from "../models/shapes";
import type { Style, StyleMode } from "../models/style";
import type { Tool } from "./diagramSlice";
import type { CanvasPortalView } from "@/lib/canvascii/live-portals";

export const editorInteractionActions = {
  pointerHover: createAction<Coords>("editor/pointerHover"),
  pointerDown: createAction<{
    coords: Coords;
    duplicate?: boolean;
    shiftKey?: boolean;
  }>("editor/pointerDown"),
  pointerUp: createAction<Coords>("editor/pointerUp"),
  pointerClick: createAction<{
    coords: Coords;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }>("editor/pointerClick"),
  pointerDoubleClick: createAction<Coords>("editor/pointerDoubleClick"),
  pointerLeave: createAction("editor/pointerLeave"),
  consumePendingCanvasScroll: createAction("editor/consumePendingCanvasScroll"),
  enableMoveDuplication: createAction("editor/enableMoveDuplication"),
  setTool: createAction<Tool>("editor/setTool"),
  addPortalView: createAction<CanvasPortalView>("editor/addPortalView"),
  updatePortalView: createAction<{ portalId: string; changes: Partial<CanvasPortalView> }>("editor/updatePortalView"),
  deletePortalView: createAction<string>("editor/deletePortalView"),
  updateText: createAction<string>("editor/updateText"),
  applyCommittedTextTransform: createAction<string>("editor/applyCommittedTextTransform"),
  setTextCursor: createAction<Coords | null>("editor/setTextCursor"),
  completeTextInput: createAction("editor/completeTextInput"),
  alignSelectedText: createAction<"LEFT" | "CENTER" | "RIGHT">("editor/alignSelectedText"),
  encloseSelectedText: createAction("editor/encloseSelectedText"),
  completePolyline: createAction("editor/completePolyline"),
  toggleBindingLock: createAction<{ shapeId: string; endpoint: "START" | "END" }>(
    "editor/toggleBindingLock",
  ),
  exitInteractionMode: createAction("editor/exitInteractionMode"),
  deleteSelection: createAction("editor/deleteSelection"),
  cycleSelection: createAction<"NEXT" | "PREVIOUS">("editor/cycleSelection"),
  selectAll: createAction("editor/selectAll"),
  copySelection: createAction("editor/copySelection"),
  pasteClipboard: createAction("editor/pasteClipboard"),
  moveInHistory: createAction<"UNDO" | "REDO">("editor/moveInHistory"),
  setStyleMode: createAction<StyleMode>("editor/setStyleMode"),
  setStyle: createAction<{ style: Partial<Style>; shapeIds?: string[] }>(
    "editor/setStyle",
  ),
  moveSelectionToFront: createAction("editor/moveSelectionToFront"),
  moveSelectionToBack: createAction("editor/moveSelectionToBack"),
  groupSelection: createAction("editor/groupSelection"),
  ungroupSelection: createAction("editor/ungroupSelection"),
  expandCanvas: createAction("editor/expandCanvas"),
  shrinkCanvasToFit: createAction("editor/shrinkCanvasToFit"),
  openExport: createAction("editor/openExport"),
  closeExport: createAction("editor/closeExport"),
  beginRectangleLabelEdit: createAction<string>("editor/beginRectangleLabelEdit"),
};
