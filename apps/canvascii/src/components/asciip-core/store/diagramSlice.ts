import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import {
  Coords,
  Line,
  MultiSegment,
  Shape,
  TextShape,
  isClosedMultiSegmentLine,
  isShapeLegal,
  normalizeMultiSegmentLine,
  normalizeTlBr,
} from "../models/shapes";
import {
  BoundingBox,
  BoundingBoxHandle,
  getBoundingBox,
  getBoundingBoxResizeHandleAtCoords,
  getShapeObjAtCoords,
  getShapeObjAtCoordsPreferSelected,
  getBoundingBoxOfAll,
  getShapeObjsInBox,
  hasResizePointAtCoords,
  isRectangleBorderLabelAtCoords,
  isShapeObjDragSurfaceAtCoords,
  isShapeObjAtCoords,
  moveShapeToBack,
  moveShapeToFront,
} from "../models/shapeInCanvas";
import _ from "lodash";
import { v4 as uuidv4 } from "uuid";
import {
  resize,
  resizeUnbounded,
  getResizePoints,
  translateAll,
  translateAllUnbounded,
  translateUnbounded,
} from "../models/transformation";
import { createLineSegment, createZeroWidthSegment } from "../models/create";
import { capText, getLines, toggleCheckboxAtIndex } from "../models/text";
import { layoutRectangleLabelLines } from "../models/rectangleText";
import {
  Style,
  StyleMode,
  defaultStyle,
  resolveRectangleBorder,
} from "../models/style";
import {
  affectsLineBindings,
  applyShapeBindings,
  bindLineEndpointAtCoords,
  getLineLabelLines,
  getMultiSegmentPointHandleAtCoords,
  isLineBoundToShape,
  isLineLikeShape,
  mergeLineLabelInput,
} from "../models/lineFeatures";
import type { CanvasPortalView } from "@/lib/canvascii/live-portals";

const DEFAULT_CANVAS_SIZE: CanvasSize = {
  rows: 75,
  cols: 250,
};

export type Tool =
  | "SELECT"
  | "PAN"
  | "FENCE"
  | "PORTAL"
  | "RECTANGLE"
  | "LINE"
  | "MULTI_SEGMENT_LINE"
  | "TEXT";

export type ShapeObject = { id: string; shape: Shape; style?: Partial<Style> };
/**
 * Groups are durable selection bundles. They let users or agents say
 * "these things belong together" without introducing a new renderable shape.
 */
export type ShapeGroup = {
  id: string;
  name?: string;
  shapeIds: string[];
};
export type CanvasSize = {
  rows: number;
  cols: number;
};

export type ActionMode =
  | { M: "BEFORE_CREATING" }
  | {
      M: "CREATE";
      start: Coords;
      curr: Coords;
      checkpoint: Shape | null;
      shape: Shape;
    }
  | { M: "SELECT"; shapeIds: string[] }
  | {
      M: "SELECT_DRAG";
      start: Coords;
      curr: Coords;
      shapeIds: string[];
      baseShapeIds: string[];
      invert: boolean;
    }
  | {
      M: "MOVE";
      start: Coords;
      shapeIds: string[];
      startShapes: Shape[];
      startConnectedLineShapes: { id: string; shape: Shape }[];
      duplicated: boolean;
    }
  | { M: "RESIZE"; resizePoint: Coords; shapeId: string; startShape: Shape }
  | {
      M: "RESIZE_MULTI";
      shapeIds: string[];
      startShapes: Shape[];
      startBounds: BoundingBox;
      handle: BoundingBoxHandle;
      anchor: Coords;
    }
  | { M: "TEXT_EDIT"; shapeId: string; startShape: TextShape }
  | { M: "LINE_TEXT_EDIT"; shapeId: string; startLines: string[] }
  | { M: "RECTANGLE_TEXT_EDIT"; shapeId: string; startLines: string[] }
  | { M: "RECTANGLE_LABEL_EDIT"; shapeId: string; startLabel: string };

export type DiagramData = {
  canvasSize: CanvasSize;
  shapes: ShapeObject[];
  groups: ShapeGroup[];
  portalViews: CanvasPortalView[];
  styleMode: StyleMode;
  globalStyle: Style;
};

export type DiagramState = DiagramData & {
  /* Edition & Navigation State of the canvas */
  currentHoveredCell: Coords | null;

  selectedTool: Tool;
  mode: ActionMode;

  history: DiagramData[];
  historyIdx: number;
  clipboard: ShapeObject[];
  textCursorCell: Coords | null;

  /* Other state of the app */
  exportInProgress: boolean;
  pendingCanvasScroll: Coords | null;
  selectedPathPoint: {
    shapeId: string;
    pointIndex: number;
  } | null;
};

export const initDiagramData = (opt?: Partial<DiagramData>): DiagramData => {
  const mergedGlobalStyle: Style = {
    ...defaultStyle(),
    ...(opt?.globalStyle ?? {}),
  };
  const { globalStyle: _globalStyleIgnored, ...restOpt } = opt ?? {};

  return {
    canvasSize: { ...DEFAULT_CANVAS_SIZE },
    shapes: [],
    groups: [],
    portalViews: [],
    styleMode: "UNICODE",
    globalStyle: mergedGlobalStyle,

    ...restOpt,
  };
};

export const initDiagramState = (opt?: Partial<DiagramData>): DiagramState => {
  const diagramData = initDiagramData(opt);

  return {
    ...diagramData,

    currentHoveredCell: null,

    selectedTool: "RECTANGLE",
    mode: { M: "BEFORE_CREATING" },

    history: [_.cloneDeep(diagramData)],
    historyIdx: 0,
    clipboard: [],
    textCursorCell: null,

    exportInProgress: false,
    pendingCanvasScroll: null,
    selectedPathPoint: null,
  };
};

export const diagramSlice = createSlice({
  name: "diagram",
  initialState: initDiagramState(),
  reducers: {
    loadDiagram: (state, action: PayloadAction<DiagramData>) => {
      return initDiagramState(action.payload);
    },
    applyCommittedDiagramState: (
      _state,
      action: PayloadAction<{ nextState: DiagramState; canonicalDiagramData: DiagramData }>
    ) => {
      const { nextState, canonicalDiagramData } = action.payload;
      const history = nextState.history.map((entry, index) =>
        index === nextState.historyIdx ? _.cloneDeep(canonicalDiagramData) : entry
      );

      return {
        ...nextState,
        canvasSize: _.cloneDeep(canonicalDiagramData.canvasSize),
        shapes: _.cloneDeep(canonicalDiagramData.shapes),
        groups: _.cloneDeep(canonicalDiagramData.groups),
        portalViews: _.cloneDeep(canonicalDiagramData.portalViews),
        styleMode: canonicalDiagramData.styleMode,
        globalStyle: _.cloneDeep(canonicalDiagramData.globalStyle),
        history,
        pendingCanvasScroll: nextState.pendingCanvasScroll,
        selectedPathPoint: nextState.selectedPathPoint,
      };
    },
    consumePendingCanvasScroll: (state) => {
      state.pendingCanvasScroll = null;
    },
    toggleLineBindingLock: (
      state,
      action: PayloadAction<{ shapeId: string; endpoint: "START" | "END" }>
    ) => {
      const { shapeId, endpoint } = action.payload;
      const shapeObj = state.shapes.find((shape) => shape.id === shapeId);
      if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
        return;
      }

      const shapeLookup = new Map(
        state.shapes.map((currentShapeObj) => [currentShapeObj.id, currentShapeObj.shape])
      );
      const nextShape = _.cloneDeep(shapeObj.shape);
      const bindingKey = endpoint === "START" ? "startBinding" : "endBinding";
      const currentBinding = nextShape[bindingKey];
      if (!currentBinding) {
        return;
      }

      nextShape[bindingKey] = {
        ...currentBinding,
        locked: !currentBinding.locked,
      };

      const reboundShape = applyShapeBindings(nextShape, shapeLookup);
      replaceShape(state, shapeId, reboundShape);
    },

    //#region Canvas actions
    expandCanvas: (state) => {
      const { rows, cols } = state.canvasSize;
      state.canvasSize = {
        rows: rows + 40,
        cols: cols + 125,
      };
    },
    shrinkCanvasToFit: (state) => {
      if (state.shapes.length === 0 && state.portalViews.length === 0) {
        state.canvasSize = {
          rows: Math.min(state.canvasSize.rows, DEFAULT_CANVAS_SIZE.rows),
          cols: Math.min(state.canvasSize.cols, DEFAULT_CANVAS_SIZE.cols),
        };
      } else {
        const shapeBounds = getBoundingBoxOfAll(state.shapes.map((so) => so.shape));
        const portalBounds = state.portalViews.length > 0
          ? {
              top: Math.min(...state.portalViews.map((portal) => portal.rect.top)),
              left: Math.min(...state.portalViews.map((portal) => portal.rect.left)),
              bottom: Math.max(...state.portalViews.map((portal) => portal.rect.top + portal.rect.height - 1)),
              right: Math.max(...state.portalViews.map((portal) => portal.rect.left + portal.rect.width - 1)),
            }
          : null;
        const bb = shapeBounds && portalBounds
          ? {
              top: Math.min(shapeBounds.top, portalBounds.top),
              left: Math.min(shapeBounds.left, portalBounds.left),
              bottom: Math.max(shapeBounds.bottom, portalBounds.bottom),
              right: Math.max(shapeBounds.right, portalBounds.right),
            }
          : shapeBounds ?? portalBounds;
        if (!bb) {
          return;
        }
        state.canvasSize = {
          rows: bb.bottom + 1,
          cols: bb.right + 1,
        };
      }
    },
    setTool: (state, action: PayloadAction<Tool>) => {
      if (state.selectedTool !== action.payload) {
        if (action.payload === "SELECT" || action.payload === "PAN") {
          state.mode = { M: "SELECT", shapeIds: [] };
        } else {
          state.mode = { M: "BEFORE_CREATING" };
        }
      }
      state.selectedPathPoint = null;
      if (action.payload !== "TEXT") {
        state.textCursorCell = null;
      }

      state.selectedTool = action.payload;
    },
    addPortalView: (state, action: PayloadAction<CanvasPortalView>) => {
      state.portalViews.push(_.cloneDeep(action.payload));
      pushHistory(state);
    },
    updatePortalView: (
      state,
      action: PayloadAction<{
        portalId: string;
        changes: Partial<CanvasPortalView>;
      }>
    ) => {
      const portalIndex = state.portalViews.findIndex(
        (portal) => portal.id === action.payload.portalId
      );
      if (portalIndex < 0) {
        return;
      }

      state.portalViews[portalIndex] = _.merge(
        {},
        state.portalViews[portalIndex],
        action.payload.changes,
      );
      pushHistory(state);
    },
    deletePortalView: (state, action: PayloadAction<string>) => {
      const portalIndex = state.portalViews.findIndex(
        (portal) => portal.id === action.payload
      );
      if (portalIndex < 0) {
        return;
      }
      state.portalViews.splice(portalIndex, 1);
      pushHistory(state);
    },
    setTextCursor: (state, action: PayloadAction<Coords | null>) => {
      const nextCursor = action.payload;
      if (
        (state.textCursorCell == null && nextCursor == null) ||
        (state.textCursorCell != null &&
          nextCursor != null &&
          state.textCursorCell.r === nextCursor.r &&
          state.textCursorCell.c === nextCursor.c)
      ) {
        return;
      }
      state.textCursorCell = action.payload;
    },
    //#endregion
    //#region Mouse actions
    onCellDoubleClick: (state, action: PayloadAction<Coords>) => {
      if (
        state.mode.M === "SELECT" ||
        state.mode.M === "TEXT_EDIT" ||
        state.mode.M === "LINE_TEXT_EDIT" ||
        state.mode.M === "RECTANGLE_TEXT_EDIT" ||
        state.mode.M === "RECTANGLE_LABEL_EDIT"
      ) {
        if (state.mode.M === "TEXT_EDIT") {
          completeTextEditing(state, { goToSelect: false });
        } else if (state.mode.M === "LINE_TEXT_EDIT") {
          completeLineTextEditing(state, { goToSelect: false });
        } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
          completeRectangleTextEditing(state, { goToSelect: false });
        } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
          completeRectangleLabelEditing(state, { goToSelect: false });
        }

        const shapeObj = getShapeObjAtCoords(state.shapes, action.payload, undefined, state.globalStyle);
        if (shapeObj?.shape.type === "TEXT") {
          state.mode = {
            M: "TEXT_EDIT",
            shapeId: shapeObj.id,
            startShape: { ...shapeObj.shape },
          };
          state.textCursorCell = null;
          return;
        }
        if (shapeObj?.shape.type === "RECTANGLE") {
          if (isRectangleBorderLabelAtCoords(shapeObj, action.payload)) {
            state.mode = {
              M: "RECTANGLE_LABEL_EDIT",
              shapeId: shapeObj.id,
              startLabel: shapeObj.shape.label ?? "",
            };
          } else {
            state.mode = {
              M: "RECTANGLE_TEXT_EDIT",
              shapeId: shapeObj.id,
              startLines: _.cloneDeep(shapeObj.shape.labelLines ?? []),
            };
          }
          state.textCursorCell = null;
          return;
        }
        if (shapeObj && isLineLikeShape(shapeObj.shape)) {
          state.mode = {
            M: "LINE_TEXT_EDIT",
            shapeId: shapeObj.id,
            startLines: _.cloneDeep(shapeObj.shape.labelLines ?? []),
          };
          state.textCursorCell = null;
        }
      } else if (
        state.mode.M === "CREATE" &&
        state.mode.shape.type === "MULTI_SEGMENT_LINE"
      ) {
        // Complete creating multi-segment line
        const createMode = state.mode;

        const newShape: MultiSegment | null = isShapeLegal(
          createMode.shape as MultiSegment
        )
          ? (createMode.shape as MultiSegment)
          : (createMode.checkpoint as MultiSegment | null);

        if (newShape) {
          const createdShapeId = addNewShape(
            state,
            finalizeMultiSegmentShape(state, newShape)
          );
          pushHistory(state);
          state.selectedTool = "SELECT";
          state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
        } else {
          state.selectedTool = "SELECT";
          state.mode = { M: "SELECT", shapeIds: [] };
        }
      }
    },
    onCellClick: (
      state,
      action: PayloadAction<{
        coords: Coords;
        ctrlKey?: boolean;
        shiftKey?: boolean;
      }>
    ) => {
      const { coords, ctrlKey = false, shiftKey = false } = action.payload;
      if (state.mode.M === "SELECT") {
        const selectMode = state.mode;
        const shapeObj = getShapeObjAtCoordsPreferSelected(
          state.shapes,
          coords,
          selectMode.shapeIds,
          state.globalStyle,
        );

        if (
          !ctrlKey &&
          !shiftKey &&
          shapeObj &&
          tryToggleCheckboxAtCoords(state, shapeObj, coords)
        ) {
          pushHistory(state);
          state.mode = {
            M: "SELECT",
            shapeIds: expandSelectionWithGroups(state, [shapeObj.id]),
          };
          state.selectedPathPoint = null;
          return;
        }

        const pathPointHandle =
          !ctrlKey &&
          !shiftKey &&
          shapeObj?.shape.type === "MULTI_SEGMENT_LINE" &&
          selectMode.shapeIds.includes(shapeObj.id)
            ? getMultiSegmentPointHandleAtCoords(shapeObj.shape, coords)
            : null;

        if (pathPointHandle && shapeObj) {
          state.selectedPathPoint = {
            shapeId: shapeObj.id,
            pointIndex: pathPointHandle.pointIndex,
          };
          state.mode = {
            M: "SELECT",
            shapeIds: expandSelectionWithGroups(state, [shapeObj.id]),
          };
          return;
        }

        let shapeIds: string[];
        if (shiftKey) {
          if (shapeObj) {
            const clickedShapeIds = expandSelectionWithGroups(state, [shapeObj.id]);
            if (clickedShapeIds.every((shapeId) => selectMode.shapeIds.includes(shapeId))) {
              shapeIds = selectMode.shapeIds.filter((id) => !clickedShapeIds.includes(id));
            } else {
              shapeIds = expandSelectionWithGroups(state, [
                ...selectMode.shapeIds,
                ...clickedShapeIds,
              ]);
            }
          } else {
            shapeIds = selectMode.shapeIds;
          }
        } else if (ctrlKey) {
          // If ctrl is pressed
          if (shapeObj) {
            const clickedShapeIds = expandSelectionWithGroups(state, [shapeObj.id]);
            if (clickedShapeIds.every((shapeId) => selectMode.shapeIds.includes(shapeId))) {
              // click on a already selected shape => deselect it
              shapeIds = selectMode.shapeIds.filter((id) => !clickedShapeIds.includes(id));
            } else {
              // click on an unselected shape => add it to selection
              shapeIds = expandSelectionWithGroups(state, [
                ...state.mode.shapeIds,
                ...clickedShapeIds,
              ]);
            }
          } else {
            // Click on an empty cell => don't change selection
            shapeIds = selectMode.shapeIds;
          }
        } else {
          // ctrl is not pressed
          if (shapeObj) {
            // Click on a shape => This shape is now selected (other shapes are deselected)
            shapeIds = expandSelectionWithGroups(state, [shapeObj.id]);
          } else {
            // Click on an empty cell => clear selection
            shapeIds = [];
          }
        }

        state.mode = {
          M: "SELECT",
          shapeIds,
        };
        if (
          state.selectedPathPoint &&
          (shapeIds.length !== 1 ||
            state.selectedPathPoint.shapeId !== shapeIds[0])
        ) {
          state.selectedPathPoint = null;
        }
      } else if (state.mode.M === "TEXT_EDIT") {
        const textEditMode = state.mode;
        const shape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        const currentShapeObj = state.shapes.find((entry) => entry.id === textEditMode.shapeId);
        const editingPointText =
          currentShapeObj?.shape.type === "TEXT" &&
          currentShapeObj.shape.start.r === coords.r &&
          currentShapeObj.shape.start.c === coords.c;
        if (shape?.id === textEditMode.shapeId || editingPointText) {
          return;
        }
        // Complete editing text
        completeTextEditing(state, { goToSelect: false });
        const nextShape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        state.mode = {
          M: "SELECT",
          shapeIds: nextShape ? [nextShape.id] : [],
        };
      } else if (state.mode.M === "LINE_TEXT_EDIT") {
        const shape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        if (shape?.id === state.mode.shapeId) {
          return;
        }
        completeLineTextEditing(state, { goToSelect: false });
        const nextShape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        state.mode = {
          M: "SELECT",
          shapeIds: nextShape ? [nextShape.id] : [],
        };
      } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
        const shape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        if (shape?.id === state.mode.shapeId) {
          return;
        }
        completeRectangleTextEditing(state, { goToSelect: false });
        const nextShape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        state.mode = {
          M: "SELECT",
          shapeIds: nextShape ? [nextShape.id] : [],
        };
      } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
        const shape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        if (shape?.id === state.mode.shapeId) {
          return;
        }
        completeRectangleLabelEditing(state, { goToSelect: false });
        const nextShape = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        state.mode = {
          M: "SELECT",
          shapeIds: nextShape ? [nextShape.id] : [],
        };
      } else if (
        state.mode.M === "BEFORE_CREATING" &&
        state.selectedTool === "MULTI_SEGMENT_LINE"
      ) {
        state.mode = {
          M: "CREATE",
          start: coords,
          curr: coords,
          checkpoint: null,
          shape: {
            type: "MULTI_SEGMENT_LINE",
            segments: [createZeroWidthSegment(coords)],
            startBinding: bindLineEndpointAtCoords(state.shapes, coords),
          },
        };
      } else if (
        state.mode.M === "CREATE" &&
        state.selectedTool === "MULTI_SEGMENT_LINE"
      ) {
        const createMode = state.mode;
        if (isShapeLegal(createMode.shape)) {
          createMode.shape = normalizeMultiSegmentLine(
            createMode.shape as MultiSegment
          );

          if (shouldCloseMultiSegmentLine(createMode.shape as MultiSegment)) {
            const createdShapeId = addNewShape(
              state,
              finalizeMultiSegmentShape(state, createMode.shape as MultiSegment)
            );
            pushHistory(state);
            state.selectedTool = "SELECT";
            state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
            return;
          }

          const latestShape = createMode.shape as MultiSegment;
          const latestEnd = latestShape.segments[latestShape.segments.length - 1]?.end;
          const canConnectToBox =
            latestEnd != null &&
            bindLineEndpointAtCoords(state.shapes, latestEnd) != null;
          if (canConnectToBox) {
            const createdShapeId = addNewShape(
              state,
              finalizeMultiSegmentShape(state, latestShape)
            );
            pushHistory(state);
            state.selectedTool = "SELECT";
            state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
            state.selectedPathPoint = null;
            return;
          }

          createMode.checkpoint = _.cloneDeep(createMode.shape as MultiSegment);

          const lastPoint =
            createMode.shape.segments[createMode.shape.segments.length - 1].end;
          createMode.start = lastPoint;
          createMode.shape.segments.push(createZeroWidthSegment(lastPoint));
        }
      } else if (
        state.mode.M === "BEFORE_CREATING" &&
        state.selectedTool === "TEXT"
      ) {
        const shapeObj = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        if (shapeObj?.shape.type === "TEXT") {
          state.mode = {
            M: "TEXT_EDIT",
            shapeId: shapeObj.id,
            startShape: { ...shapeObj.shape },
          };
          state.textCursorCell = null;
          return;
        }
        const createdShape: TextShape = {
          type: "TEXT",
          start: coords,
          lines: [],
        };
        const createdShapeId = addNewShape(state, createdShape);
        pushHistory(state);
        state.mode = {
          M: "TEXT_EDIT",
          shapeId: createdShapeId,
          startShape: _.cloneDeep(createdShape),
        };
        state.textCursorCell = null;
      } else if (
        state.mode.M === "CREATE" &&
        state.selectedTool === "TEXT" &&
        state.mode.shape.type === "TEXT"
      ) {
        const shapeObj = getShapeObjAtCoords(state.shapes, coords, undefined, state.globalStyle);
        if (
          shapeObj?.shape.type === "TEXT" &&
          isTextShapeEmpty(state.mode.shape)
        ) {
          state.mode = {
            M: "TEXT_EDIT",
            shapeId: shapeObj.id,
            startShape: { ...shapeObj.shape },
          };
          state.textCursorCell = null;
          return;
        }
        // Complete creating text
        completeTextCreation(state, { goToSelect: false });
      }
    },
    onCellMouseDown: (
      state,
      action: PayloadAction<{
        coords: Coords;
        duplicate?: boolean;
        shiftKey?: boolean;
      }>
    ) => {
      const { coords, duplicate = false, shiftKey = false } = action.payload;
      state.selectedPathPoint = null;
      if (state.mode.M === "SELECT") {
        if (shiftKey) {
          state.mode = {
            M: "SELECT_DRAG",
            start: coords,
            curr: coords,
            shapeIds: state.mode.shapeIds,
            baseShapeIds: state.mode.shapeIds,
            invert: true,
          };
          return;
        }

        if (state.mode.shapeIds.length > 1) {
          const selectedShapeObjs = toShapeObjects(state.shapes, state.mode.shapeIds);
          const selectedBounds = getBoundingBoxOfAll(
            selectedShapeObjs.map((shapeObj) => shapeObj.shape)
          );
          if (selectedBounds) {
            const handle = getBoundingBoxResizeHandleAtCoords(
              selectedBounds,
              coords
            );
            if (handle) {
              state.mode = {
                M: "RESIZE_MULTI",
                shapeIds: state.mode.shapeIds,
                startShapes: selectedShapeObjs.map((shapeObj) =>
                  _.cloneDeep(shapeObj.shape)
                ),
                startBounds: _.cloneDeep(selectedBounds),
                handle,
                anchor: getBoundingBoxAnchorForHandle(selectedBounds, handle),
              };
              return;
            }
          }
        }

        const shapeObjAtCoords = getShapeObjAtCoordsPreferSelected(
          state.shapes,
          coords,
          state.mode.shapeIds,
          state.globalStyle,
        );
        if (!shapeObjAtCoords) {
          state.mode = {
            M: "SELECT_DRAG",
            start: coords,
            curr: coords,
            shapeIds: [],
            baseShapeIds: state.mode.shapeIds,
            invert: false,
          };
          return;
        }

        const clickedShapeIsSelected = state.mode.shapeIds.includes(
          shapeObjAtCoords.id
        );

        // Dragging an unselected shape should select+drag it in one gesture.
        if (!clickedShapeIsSelected) {
          if (duplicate) {
            const detachedShape = detachLineBindings(_.cloneDeep(shapeObjAtCoords.shape));
            const duplicatedShapeId = addNewShape(
              state,
              detachedShape,
              shapeObjAtCoords.style
            );
            const duplicatedShapeObj = toShapeObject(
              state.shapes,
              duplicatedShapeId
            );
            state.mode = {
              M: "MOVE",
              shapeIds: [duplicatedShapeId],
              start: coords,
              startShapes: [_.cloneDeep(duplicatedShapeObj.shape)],
              startConnectedLineShapes: [],
              duplicated: true,
            };
          } else {
            state.mode = {
              M: "MOVE",
              shapeIds: [shapeObjAtCoords.id],
              start: coords,
              startShapes: [_.cloneDeep(shapeObjAtCoords.shape)],
              startConnectedLineShapes: getConnectedBoundLineStartShapes(state.shapes, [shapeObjAtCoords.id]),
              duplicated: false,
            };
          }
          return;
        }

        if (state.mode.shapeIds.length === 1) {
          const shapeObj = shapeObjAtCoords;

          if (duplicate && isShapeObjDragSurfaceAtCoords(shapeObj, coords, state.globalStyle)) {
            const detachedShape = detachLineBindings(_.cloneDeep(shapeObj.shape));
            const duplicatedShapeId = addNewShape(
              state,
              detachedShape,
              shapeObj.style
            );
            const duplicatedShapeObj = toShapeObject(state.shapes, duplicatedShapeId);
            state.mode = {
              M: "MOVE",
              shapeIds: [duplicatedShapeId],
              start: coords,
              startShapes: [_.cloneDeep(duplicatedShapeObj.shape)],
              startConnectedLineShapes: [],
              duplicated: true,
            };
          } else if (hasResizePointAtCoords(shapeObj.shape, coords)) {
            state.mode = {
              M: "RESIZE",
              shapeId: shapeObj.id,
              resizePoint: coords,
              startShape: { ...shapeObj.shape },
            };
          } else if (isShapeObjDragSurfaceAtCoords(shapeObj, coords, state.globalStyle)) {
            state.mode = {
              M: "MOVE",
              shapeIds: [shapeObj.id],
              start: coords,
              startShapes: [{ ...shapeObj.shape }],
              startConnectedLineShapes: getConnectedBoundLineStartShapes(state.shapes, [shapeObj.id]),
              duplicated: false,
            };
          }
          return;
        }

        if (state.mode.shapeIds.length > 1) {
          const shapeObjs = toShapeObjects(state.shapes, state.mode.shapeIds);
          if (shapeObjs.some((so) => isShapeObjDragSurfaceAtCoords(so, coords, state.globalStyle))) {
            if (duplicate) {
              const duplicatedShapeIds = shapeObjs.map((shapeObj) =>
                addNewShape(state, detachLineBindings(_.cloneDeep(shapeObj.shape)), shapeObj.style)
              );
              const duplicatedShapeObjs = toShapeObjects(
                state.shapes,
                duplicatedShapeIds
              );
              state.mode = {
                M: "MOVE",
                shapeIds: duplicatedShapeIds,
                start: coords,
                startShapes: duplicatedShapeObjs.map((so) => _.cloneDeep(so.shape)),
                startConnectedLineShapes: [],
                duplicated: true,
              };
              return;
            }
            state.mode = {
              M: "MOVE",
              shapeIds: state.mode.shapeIds,
              start: coords,
              startShapes: shapeObjs.map((so) => _.cloneDeep(so.shape)),
              startConnectedLineShapes: getConnectedBoundLineStartShapes(state.shapes, state.mode.shapeIds),
              duplicated: false,
            };
          }
          return;
        }
      } else if (
        state.mode.M === "BEFORE_CREATING" &&
        state.selectedTool === "RECTANGLE"
      ) {
        state.mode = {
          M: "CREATE",
          start: coords,
          curr: coords,
          checkpoint: null,
          shape: {
            type: "RECTANGLE",
            tl: coords,
            br: coords,
          },
        };
      } else if (
        state.mode.M === "BEFORE_CREATING" &&
        state.selectedTool === "LINE"
      ) {
        state.mode = {
          M: "CREATE",
          start: coords,
          curr: coords,
          checkpoint: null,
          shape: {
            type: "LINE",
            ...createZeroWidthSegment(coords),
            startBinding: bindLineEndpointAtCoords(state.shapes, coords),
          },
        };
      } else if (
        state.mode.M === "BEFORE_CREATING" &&
        state.selectedTool === "TEXT"
      ) {
        state.mode = {
          M: "CREATE",
          start: coords,
          curr: coords,
          checkpoint: null,
          shape: { type: "TEXT", start: coords, lines: [] },
        };
        state.textCursorCell = null;
      }
    },
    onCellMouseUp: (state, action: PayloadAction<Coords>) => {
      if (state.mode.M === "SELECT_DRAG") {
        state.mode = {
          M: "SELECT",
          shapeIds: state.mode.shapeIds,
        };
      } else if (state.mode.M === "MOVE") {
        // Complete moving a shape
        pushHistory(state);
        state.mode = {
          M: "SELECT",
          shapeIds: state.mode.shapeIds,
        };
      } else if (state.mode.M === "RESIZE") {
        // Complete resizing a shape
        pushHistory(state);
        state.mode = {
          M: "SELECT",
          shapeIds: [state.mode.shapeId],
        };
      } else if (state.mode.M === "RESIZE_MULTI") {
        pushHistory(state);
        state.mode = {
          M: "SELECT",
          shapeIds: state.mode.shapeIds,
        };
      } else if (state.mode.M === "CREATE" && state.mode.shape.type === "TEXT") {
        const createdShapeId = addNewShape(state, state.mode.shape);
        pushHistory(state);
        state.mode = {
          M: "TEXT_EDIT",
          shapeId: createdShapeId,
          startShape: _.cloneDeep(state.mode.shape),
        };
      } else if (
        state.mode.M === "CREATE" &&
        (state.mode.shape.type === "RECTANGLE" ||
          state.mode.shape.type === "LINE")
      ) {
        // Complete creating a rectangle or a line
        const newShape: Shape | null = isShapeLegal(state.mode.shape)
          ? state.mode.shape
          : null;

        if (newShape) {
          const rectangleStyleOverride =
            newShape.type === "RECTANGLE"
              ? state.selectedTool === "TEXT"
                ? getTextRectangleStyleOverride()
                : state.selectedTool === "RECTANGLE"
                  ? getRectangleCreationStyleOverride()
                  : undefined
              : undefined;
          const createdShapeId = addNewShape(
            state,
            withResolvedLineBindings(state, newShape),
            rectangleStyleOverride
          );
          pushHistory(state);
          if (state.selectedTool === "TEXT" && newShape.type === "RECTANGLE") {
            state.mode = {
              M: "RECTANGLE_TEXT_EDIT",
              shapeId: createdShapeId,
              startLines: [],
            };
          } else {
            state.selectedTool = "SELECT";
            state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
          }
        } else {
          state.selectedTool = "SELECT";
          state.mode = { M: "SELECT", shapeIds: [] };
        }
      }
    },
    onCellHover: (state, action: PayloadAction<Coords>) => {
      state.currentHoveredCell = action.payload;

      if (state.mode.M === "SELECT_DRAG") {
        const selectDragMode = state.mode;
        const curr = action.payload;

        const [tl, br] = normalizeTlBr(selectDragMode.start, curr);

        const selectedShapes = getShapeObjsInBox(state.shapes, tl, br);
        const selectedShapeIds = expandSelectionWithGroups(
          state,
          selectedShapes.map((s) => s.id)
        );
        const shapeIds = selectDragMode.invert
          ? (() => {
              const selectedSet = new Set(selectedShapeIds);
              const baseSet = new Set(selectDragMode.baseShapeIds);
              const keptBase = selectDragMode.baseShapeIds.filter(
                (id) => !selectedSet.has(id)
              );
              const added = selectedShapeIds.filter((id) => !baseSet.has(id));
              return [...keptBase, ...added];
            })()
          : selectedShapeIds;

        state.mode = {
          ...selectDragMode,
          curr,
          shapeIds,
        };
      } else if (state.mode.M === "MOVE") {
        const moveMode = state.mode;
        //* I'm currently moving a Shape and I change mouse position => Update shape position
        // Get selected shape

        const from = moveMode.start;
        const to = action.payload;
        const delta = { r: to.r - from.r, c: to.c - from.c };
        const rawTranslatedShapes: Shape[] = translateAllUnbounded(
          moveMode.startShapes,
          delta
        );
        const canvasShift = extendCanvasToFitShapes(state, rawTranslatedShapes);
        const translatedShapes =
          canvasShift.r !== 0 || canvasShift.c !== 0
            ? shiftShapes(rawTranslatedShapes, canvasShift)
            : rawTranslatedShapes;
        const nextMoveMode = state.mode.M === "MOVE" ? state.mode : moveMode;

        nextMoveMode.shapeIds.forEach((id, idx) => {
          replaceShape(state, id, translatedShapes[idx]);
        });
        const selectedShapeIdSet = new Set(nextMoveMode.shapeIds);
        const shapeLookup = new Map(state.shapes.map((shapeObj) => [shapeObj.id, shapeObj.shape]));
        nextMoveMode.shapeIds.forEach((shapeId) => {
          const shapeObj = state.shapes.find((shape) => shape.id === shapeId);
          if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
            return;
          }
          if (!shapeObj.shape.startBinding && !shapeObj.shape.endBinding) {
            return;
          }
          const startTargetSelected =
            shapeObj.shape.startBinding &&
            selectedShapeIdSet.has(shapeObj.shape.startBinding.targetShapeId);
          const endTargetSelected =
            shapeObj.shape.endBinding &&
            selectedShapeIdSet.has(shapeObj.shape.endBinding.targetShapeId);
          if (startTargetSelected && endTargetSelected) {
            shapeLookup.set(shapeId, shapeObj.shape);
            return;
          }
          const reboundShape = applyShapeBindings(shapeObj.shape, shapeLookup);
          replaceShape(state, shapeId, reboundShape);
          shapeLookup.set(shapeId, reboundShape);
        });
        const movedShapeIds = nextMoveMode.shapeIds.filter((shapeId) => {
          const shapeObj = state.shapes.find((shape) => shape.id === shapeId);
          return shapeObj ? affectsLineBindings(shapeObj.shape) : false;
        });
        syncBoundLineShapesForTranslation(
          state,
          movedShapeIds,
          delta,
          nextMoveMode.startConnectedLineShapes,
        );
      } else if (state.mode.M === "RESIZE") {
        const resizeMode = state.mode;
        //* I'm currently resizing a Shape and I change mouse position => Update shape

        // Get selected shape
        const selectedShapeIdx: number = state.shapes.findIndex(
          (s) => s.id === resizeMode.shapeId
        )!;
        // Resize shape
        const resizePoint = resizeMode.resizePoint;
        const to = action.payload;
        const delta = { r: to.r - resizePoint.r, c: to.c - resizePoint.c };
        const rawResizedShape: Shape = resizeUnbounded(
          resizeMode.startShape,
          resizePoint,
          delta
        );
        const canvasShift = extendCanvasToFitShapes(state, [rawResizedShape]);
        const resizedShape =
          canvasShift.r !== 0 || canvasShift.c !== 0
            ? shiftShape(rawResizedShape, canvasShift)
            : rawResizedShape;
        if (isShapeLegal(resizedShape)) {
          const resolvedResizedShape = isLineLikeShape(resizedShape)
            ? resolveLineBindingsForResize(
                state,
                resizedShape,
                isLineLikeShape(resizeMode.startShape)
                  ? getLineResizeHandle(resizeMode.startShape, resizeMode.resizePoint)
                  : null,
              )
            : resizedShape;
          // Replace resized shape
          state.shapes[selectedShapeIdx].shape = resolvedResizedShape;
          if (affectsLineBindings(resolvedResizedShape)) {
            syncBoundLineShapes(state, [resizeMode.shapeId]);
          }
        }
      } else if (state.mode.M === "RESIZE_MULTI") {
        const resizeMultiMode = state.mode;
        const resizedBounds = getBoundingBoxFromAnchorAndPointer(
          resizeMultiMode.anchor,
          action.payload
        );
        const rawResizedShapes = resizeMultiMode.startShapes.map((shape) =>
          scaleShapeWithinBounds(shape, resizeMultiMode.startBounds, resizedBounds)
        );
        const canvasShift = extendCanvasToFitShapes(state, rawResizedShapes);
        const resizedShapes =
          canvasShift.r !== 0 || canvasShift.c !== 0
            ? shiftShapes(rawResizedShapes, canvasShift)
            : rawResizedShapes;
        const nextResizeMultiMode =
          state.mode.M === "RESIZE_MULTI" ? state.mode : resizeMultiMode;

        nextResizeMultiMode.shapeIds.forEach((shapeId, idx) => {
          replaceShape(state, shapeId, resizedShapes[idx]);
        });
        const resizedIds = nextResizeMultiMode.shapeIds.filter((shapeId) => {
          const shapeObj = state.shapes.find((shape) => shape.id === shapeId);
          return shapeObj ? affectsLineBindings(shapeObj.shape) : false;
        });
        syncBoundLineShapes(state, resizedIds);
      } else if (
        state.mode.M === "CREATE" &&
        (state.selectedTool === "RECTANGLE" ||
          state.selectedTool === "TEXT" ||
          state.selectedTool === "LINE" ||
          state.selectedTool === "MULTI_SEGMENT_LINE")
      ) {
        const creationMode = state.mode;
        if (!_.isEqual(creationMode.curr, action.payload)) {
          const curr = action.payload;
          switch (creationMode.shape.type) {
            case "RECTANGLE": {
              const [tl, br] = normalizeTlBr(creationMode.start, curr);
              const rawShape: Shape = {
                ...creationMode.shape,
                tl,
                br,
              };
              const canvasShift = extendCanvasToFitShapes(state, [rawShape]);
              const nextCreateMode = state.mode.M === "CREATE" ? state.mode : creationMode;
              state.mode = {
                ...nextCreateMode,
                curr: shiftCoords(curr, canvasShift),
                shape:
                  canvasShift.r !== 0 || canvasShift.c !== 0
                    ? shiftShape(rawShape, canvasShift)
                    : rawShape,
              };
              break;
            }
            case "TEXT": {
              const [tl, br] = normalizeTlBr(creationMode.start, curr);
              const rawShape: Shape = {
                type: "RECTANGLE",
                tl,
                br,
                labelLines: [],
              };
              const canvasShift = extendCanvasToFitShapes(state, [rawShape]);
              const nextCreateMode = state.mode.M === "CREATE" ? state.mode : creationMode;
              state.mode = {
                ...nextCreateMode,
                curr: shiftCoords(curr, canvasShift),
                shape:
                  canvasShift.r !== 0 || canvasShift.c !== 0
                    ? shiftShape(rawShape, canvasShift)
                    : rawShape,
              };
              break;
            }
            case "LINE": {
              const rawShape: Shape = {
                ...creationMode.shape,
                type: "LINE",
                ...createLineSegment(creationMode.start, curr),
              };
              const canvasShift = extendCanvasToFitShapes(state, [rawShape]);
              const nextCreateMode = state.mode.M === "CREATE" ? state.mode : creationMode;
              state.mode = {
                ...nextCreateMode,
                curr: shiftCoords(curr, canvasShift),
                shape:
                  canvasShift.r !== 0 || canvasShift.c !== 0
                    ? shiftShape(rawShape, canvasShift)
                    : rawShape,
              };
              break;
            }
            case "MULTI_SEGMENT_LINE": {
              const rawShape = _.cloneDeep(creationMode.shape);
              const newSegment = createLineSegment(creationMode.start, curr);
              rawShape.segments.pop();
              rawShape.segments.push(newSegment);
              const canvasShift = extendCanvasToFitShapes(state, [rawShape]);
              const nextCreateMode = state.mode.M === "CREATE" ? state.mode : creationMode;
              state.mode = {
                ...nextCreateMode,
                curr: shiftCoords(curr, canvasShift),
                shape:
                  canvasShift.r !== 0 || canvasShift.c !== 0
                    ? (shiftShape(rawShape, canvasShift) as MultiSegment)
                    : rawShape,
              };
              break;
            }
          }
        }
      }
    },
    onCanvasMouseLeave: (state) => {
      state.currentHoveredCell = null;
    },
    //#endregion
    //#region Keyboard actions
    onCtrlEnterPress: (state) => {
      if (state.mode.M === "CREATE" && state.selectedTool === "TEXT") {
        completeTextToolCreation(state, { goToSelect: false });
      } else if (state.mode.M === "TEXT_EDIT") {
        completeTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "LINE_TEXT_EDIT") {
        completeLineTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
        completeRectangleTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
        completeRectangleLabelEditing(state, { goToSelect: false });
      }
    },
    onEnterPress: (state) => {
      if (
        state.mode.M === "CREATE" &&
        state.selectedTool === "MULTI_SEGMENT_LINE"
      ) {
        const createMode = state.mode;
        const newShape: MultiSegment | null = isShapeLegal(
          createMode.shape as MultiSegment
        )
          ? (createMode.shape as MultiSegment)
          : (createMode.checkpoint as MultiSegment | null);

        if (newShape) {
          const createdShapeId = addNewShape(
            state,
            finalizeMultiSegmentShape(state, newShape)
          );
          pushHistory(state);
          state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
        } else {
          state.mode = { M: "SELECT", shapeIds: [] };
        }
      }
    },
    onExitEditModePress: (state) => {
      if (state.mode.M === "CREATE" && state.selectedTool === "TEXT") {
        completeTextToolCreation(state, { goToSelect: true });
        return;
      }
      if (state.mode.M === "TEXT_EDIT") {
        completeTextEditing(state, { goToSelect: true });
        return;
      }
      if (state.mode.M === "LINE_TEXT_EDIT") {
        completeLineTextEditing(state, { goToSelect: true });
        return;
      }
      if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
        completeRectangleTextEditing(state, { goToSelect: true });
        return;
      }
      if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
        completeRectangleLabelEditing(state, { goToSelect: true });
        return;
      }

      if (
        state.mode.M === "CREATE" &&
        (state.mode.shape.type === "RECTANGLE" ||
          state.mode.shape.type === "LINE")
      ) {
        const newShape: Shape | null = isShapeLegal(state.mode.shape)
          ? state.mode.shape
          : null;
        if (newShape) {
          const createdShapeId = addNewShape(
            state,
            withResolvedLineBindings(state, newShape)
          );
          pushHistory(state);
          state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
        } else {
          state.mode = { M: "SELECT", shapeIds: [] };
        }
      } else if (
        state.mode.M === "CREATE" &&
        state.mode.shape.type === "MULTI_SEGMENT_LINE"
      ) {
        const createMode = state.mode;

        const newShape: MultiSegment | null = isShapeLegal(
          createMode.shape as MultiSegment
        )
          ? (createMode.shape as MultiSegment)
          : (createMode.checkpoint as MultiSegment | null);

        if (newShape) {
          const createdShapeId = addNewShape(
            state,
            finalizeMultiSegmentShape(state, newShape)
          );
          pushHistory(state);
          state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
        } else {
          state.mode = { M: "SELECT", shapeIds: [] };
        }
      } else if (state.mode.M === "MOVE") {
        pushHistory(state);
        state.mode = { M: "SELECT", shapeIds: state.mode.shapeIds };
      } else if (state.mode.M === "RESIZE") {
        pushHistory(state);
        state.mode = { M: "SELECT", shapeIds: [state.mode.shapeId] };
      } else if (state.mode.M === "RESIZE_MULTI") {
        pushHistory(state);
        state.mode = { M: "SELECT", shapeIds: state.mode.shapeIds };
      } else if (state.mode.M === "SELECT_DRAG") {
        state.mode = { M: "SELECT", shapeIds: state.mode.shapeIds };
      } else if (state.mode.M === "SELECT") {
        state.mode = { M: "SELECT", shapeIds: state.mode.shapeIds };
      } else {
        state.mode = { M: "SELECT", shapeIds: [] };
      }

      state.selectedTool = "SELECT";
      state.textCursorCell = null;
    },
    onDeletePress: (state) => {
      if (
        state.mode.M === "SELECT" &&
        state.selectedPathPoint &&
        state.mode.shapeIds.length === 1 &&
        state.selectedPathPoint.shapeId === state.mode.shapeIds[0]
      ) {
        const shapeObj = state.shapes.find((shape) => shape.id === state.selectedPathPoint?.shapeId);
        if (shapeObj?.shape.type === "MULTI_SEGMENT_LINE") {
          const nextShape = removeMultiSegmentPoint(
            shapeObj.shape,
            state.selectedPathPoint.pointIndex,
          );
          if (nextShape) {
            shapeObj.shape = nextShape;
            pushHistory(state);
          }
        }
        state.selectedPathPoint = null;
        return;
      }

      if (state.mode.M === "SELECT" && state.mode.shapeIds.length > 0) {
        deleteShapes(state, state.mode.shapeIds);
        pushHistory(state);
        state.mode = { M: "SELECT", shapeIds: [] };
        state.selectedPathPoint = null;
      }
    },
    cycleSelection: (state, action: PayloadAction<"NEXT" | "PREVIOUS">) => {
      const orderedShapeIds = getVisualSelectionOrder(state.shapes);
      if (orderedShapeIds.length === 0) {
        return;
      }

      const activeSelection = getActiveSelectionShapeIds(state);
      if (activeSelection.length === 0) {
        return;
      }

      const activeSet = new Set(activeSelection);
      const currentId =
        orderedShapeIds.find((shapeId) => activeSet.has(shapeId)) ?? activeSelection[0] ?? null;
      const currentIndex = currentId ? orderedShapeIds.indexOf(currentId) : -1;
      const nextIndex =
        action.payload === "PREVIOUS"
          ? currentIndex <= 0
            ? orderedShapeIds.length - 1
            : currentIndex - 1
          : currentIndex === -1 || currentIndex >= orderedShapeIds.length - 1
          ? 0
          : currentIndex + 1;

      state.mode = { M: "SELECT", shapeIds: [orderedShapeIds[nextIndex]!] };
      state.selectedTool = "SELECT";
      state.selectedPathPoint = null;
      state.textCursorCell = null;
    },
    onCtrlAPress: (state) => {
      if (state.mode.M === "SELECT") {
        state.mode.shapeIds = state.shapes.map((s) => s.id);
      }
    },
    onEnableMoveDuplication: (state) => {
      if (state.mode.M !== "MOVE" || state.mode.duplicated) return;
      const moveMode = state.mode;
      const sourceShapeObjs = toShapeObjects(state.shapes, moveMode.shapeIds);

      // Restore originals to their initial position before creating duplicates.
      moveMode.shapeIds.forEach((shapeId, idx) => {
        replaceShape(state, shapeId, _.cloneDeep(moveMode.startShapes[idx]));
      });

      const duplicatedShapeIds = moveMode.startShapes.map((shape, idx) =>
        addNewShape(state, _.cloneDeep(shape), sourceShapeObjs[idx]?.style)
      );
      moveMode.shapeIds = duplicatedShapeIds;
      moveMode.startShapes = moveMode.startShapes.map((shape) =>
        _.cloneDeep(shape)
      );
      moveMode.duplicated = true;
    },
    onCopyPress: (state) => {
      if (state.mode.M !== "SELECT" || state.mode.shapeIds.length === 0) return;
      state.clipboard = _.cloneDeep(toShapeObjects(state.shapes, state.mode.shapeIds));
    },
    onPastePress: (state) => {
      if (state.clipboard.length === 0) return;

      const clipboardShapes = state.clipboard.map((shapeObj) =>
        _.cloneDeep(shapeObj.shape)
      );
      const clipboardBb = getBoundingBoxOfAll(clipboardShapes);
      if (!clipboardBb) return;

      const pasteAnchor = state.currentHoveredCell ?? {
        r: clipboardBb.top + 1,
        c: clipboardBb.left + 1,
      };
      const translatedShapes = translateAll(
        clipboardShapes,
        { r: pasteAnchor.r - clipboardBb.top, c: pasteAnchor.c - clipboardBb.left },
        state.canvasSize
      );

      const createdShapeIds = translatedShapes.map((shape, idx) =>
        addNewShape(state, shape, state.clipboard[idx]?.style)
      );

      pushHistory(state);
      state.selectedTool = "SELECT";
      state.mode = { M: "SELECT", shapeIds: createdShapeIds };
    },
    //#endregion

    updateText: (state, action: PayloadAction<string>) => {
      applyUpdatedTextValue(state, action.payload);
    },
    applyCommittedTextTransform: (state, action: PayloadAction<string>) => {
      const before = _.cloneDeep({
        shapes: state.shapes,
        mode: state.mode,
      });
      applyUpdatedTextValue(state, action.payload);

      if (!_.isEqual(before.shapes, state.shapes)) {
        pushHistory(state);
        refreshTextEditBaseline(state);
      }
    },
    beginRectangleLabelEdit: (state, action: PayloadAction<string>) => {
      if (state.mode.M === "TEXT_EDIT") {
        completeTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "LINE_TEXT_EDIT") {
        completeLineTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
        completeRectangleTextEditing(state, { goToSelect: false });
      } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
        completeRectangleLabelEditing(state, { goToSelect: false });
      }

      const shapeObj = state.shapes.find((shape) => shape.id === action.payload);
      if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
        return;
      }

      state.mode = {
        M: "RECTANGLE_LABEL_EDIT",
        shapeId: shapeObj.id,
        startLabel: shapeObj.shape.label ?? "",
      };
      state.textCursorCell = null;
    },
    alignSelectedText: (
      state,
      action: PayloadAction<"LEFT" | "CENTER" | "RIGHT">
    ) => {
      if (state.mode.M !== "SELECT") {
        return;
      }
      if (state.mode.shapeIds.length !== 1) {
        return;
      }
      const selectedShapeId = state.mode.shapeIds[0];
      const shapeObj = state.shapes.find((shape) => shape.id === selectedShapeId);
      if (!shapeObj) return;

      if (shapeObj.shape.type === "TEXT") {
        shapeObj.shape = {
          ...shapeObj.shape,
          lines: alignTextLines(shapeObj.shape.lines, action.payload),
        };
        pushHistory(state);
        return;
      }

      if (shapeObj.shape.type === "RECTANGLE") {
        shapeObj.style = {
          ...(shapeObj.style ?? {}),
          rectangleTextAlignH: action.payload,
        };
        pushHistory(state);
      }
    },
    encloseSelectedText: (state) => {
      if (state.mode.M !== "SELECT") {
        return;
      }
      if (state.mode.shapeIds.length !== 1) {
        return;
      }
      const selectedShapeId = state.mode.shapeIds[0];
      const shapeObj = state.shapes.find((shape) => shape.id === selectedShapeId);
      if (!shapeObj || shapeObj.shape.type !== "TEXT" || isTextShapeEmpty(shapeObj.shape)) {
        return;
      }

      const longestLineLength = Math.max(
        1,
        ...shapeObj.shape.lines.map((line) => Array.from(line).length)
      );
      const nextRectangle: Shape = {
        type: "RECTANGLE",
        tl: {
          r: shapeObj.shape.start.r - 1,
          c: shapeObj.shape.start.c - 1,
        },
        br: {
          r: shapeObj.shape.start.r + Math.max(1, shapeObj.shape.lines.length),
          c: shapeObj.shape.start.c + longestLineLength,
        },
        labelLines: [...shapeObj.shape.lines],
      };
      const canvasShift = extendCanvasToFitShapes(state, [nextRectangle]);
      replaceShape(
        state,
        shapeObj.id,
        shiftShape(nextRectangle, canvasShift),
      );
      syncBoundLineShapes(state, [shapeObj.id]);
      pushHistory(state);
      state.mode = { M: "SELECT", shapeIds: [shapeObj.id] };
      state.selectedTool = "SELECT";
    },
    onMoveToFrontButtonClick: (state) => {
      if (state.mode.M === "SELECT" && state.mode.shapeIds.length === 1) {
        state.shapes = moveShapeToFront(state.shapes, state.mode.shapeIds[0]);
        pushHistory(state);
      }
    },
    onMoveToBackButtonClick: (state) => {
      if (state.mode.M === "SELECT" && state.mode.shapeIds.length === 1) {
        state.shapes = moveShapeToBack(state.shapes, state.mode.shapeIds[0]);
        pushHistory(state);
      }
    },
    groupSelection: (state) => {
      if (state.mode.M !== "SELECT" || state.mode.shapeIds.length < 2) {
        return;
      }

      const groupedShapeIds = Array.from(
        new Set(expandSelectionWithGroups(state, state.mode.shapeIds))
      );
      state.groups = state.groups.filter(
        (group) => !group.shapeIds.some((shapeId) => groupedShapeIds.includes(shapeId))
      );
      state.groups.push({
        id: uuidv4(),
        shapeIds: groupedShapeIds,
      });
      state.mode = { M: "SELECT", shapeIds: groupedShapeIds };
      pushHistory(state);
    },
    ungroupSelection: (state) => {
      if (state.mode.M !== "SELECT" || state.mode.shapeIds.length === 0) {
        return;
      }

      const selectedShapeIds = new Set(state.mode.shapeIds);
      const nextGroups = state.groups.filter(
        (group) => !group.shapeIds.some((shapeId) => selectedShapeIds.has(shapeId))
      );
      if (nextGroups.length === state.groups.length) {
        return;
      }
      state.groups = nextGroups;
      pushHistory(state);
    },
    //#region history actions
    moveInHistory: (state, action: PayloadAction<"UNDO" | "REDO">) => {
      const currentMode = state.mode;
      action.payload === "UNDO" ? undoHistory(state) : redoHistory(state);

      if (
        currentMode.M === "TEXT_EDIT" ||
        currentMode.M === "LINE_TEXT_EDIT" ||
        currentMode.M === "RECTANGLE_TEXT_EDIT" ||
        currentMode.M === "RECTANGLE_LABEL_EDIT"
      ) {
        state.mode = currentMode;
        refreshTextEditBaseline(state);
        return;
      }

      state.mode =
        state.selectedTool === "SELECT"
          ? { M: "SELECT", shapeIds: [] }
          : { M: "BEFORE_CREATING" };
      state.textCursorCell = null;
    },

    //#endregion

    //#region Styling actions
    setStyleMode: (state, action: PayloadAction<StyleMode>) => {
      state.styleMode = action.payload;

      /*
        If the user switched to ASCII, styles won't matter anymore, but for simplicity, we will still save
        style information with each new shape.

        To prevent surprises, if the user goes back to Unicode, in ASCII mode, all new shapes will have default styles
      */
      if (action.payload === "ASCII") {
        state.globalStyle = defaultStyle();
      }
      pushHistory(state);
    },
    setStyle: (
      state,
      action: PayloadAction<{ style: Partial<Style>; shapeIds?: string[] }>
    ) => {
      const { style, shapeIds } = action.payload;
      if (!shapeIds) {
        _.merge(state.globalStyle, style);
      } else {
        shapeIds.forEach((sid) => {
          const shapeObj = state.shapes.find((s) => s.id === sid);
          if (shapeObj) {
            if ("style" in shapeObj) {
              _.merge(shapeObj.style, style);
            } else {
              shapeObj.style = style;
            }
          }
        });
      }
      pushHistory(state);
    },
    //#endregion
    //#region Other App actions
    openExport: (state) => {
      state.exportInProgress = true;
    },
    closeExport: (state) => {
      state.exportInProgress = false;
    }, //#endregion
  },
});

//#region Helper state function that mutate directly the state
const AUTO_EXTEND_ROW_BUFFER = 12;
const AUTO_EXTEND_COL_BUFFER = 24;

function shiftCoords(coords: Coords, delta: Coords): Coords {
  return {
    r: coords.r + delta.r,
    c: coords.c + delta.c,
  };
}

function shiftBoundingBox(bounds: BoundingBox, delta: Coords): BoundingBox {
  return {
    top: bounds.top + delta.r,
    bottom: bounds.bottom + delta.r,
    left: bounds.left + delta.c,
    right: bounds.right + delta.c,
  };
}

function shiftShape(shape: Shape, delta: Coords): Shape {
  return translateUnbounded(shape, delta);
}

function shiftShapes(shapes: Shape[], delta: Coords): Shape[] {
  return translateAllUnbounded(shapes, delta);
}

function shiftShapeObject(shapeObj: ShapeObject, delta: Coords): ShapeObject {
  return {
    ...shapeObj,
    shape: shiftShape(shapeObj.shape, delta),
  };
}

function queuePendingCanvasScroll(state: DiagramState, delta: Coords): void {
  if (delta.r === 0 && delta.c === 0) return;
  const pending = state.pendingCanvasScroll;
  state.pendingCanvasScroll = pending
    ? {
        r: pending.r + delta.r,
        c: pending.c + delta.c,
      }
    : delta;
}

function shiftActionMode(mode: ActionMode, delta: Coords): ActionMode {
  switch (mode.M) {
    case "BEFORE_CREATING":
      return mode;
    case "CREATE":
      return {
        ...mode,
        start: shiftCoords(mode.start, delta),
        curr: shiftCoords(mode.curr, delta),
        checkpoint: mode.checkpoint ? shiftShape(mode.checkpoint, delta) : null,
        shape: shiftShape(mode.shape, delta),
      };
    case "SELECT":
      return mode;
    case "SELECT_DRAG":
      return {
        ...mode,
        start: shiftCoords(mode.start, delta),
        curr: shiftCoords(mode.curr, delta),
      };
    case "MOVE":
      return {
        ...mode,
        start: shiftCoords(mode.start, delta),
        startShapes: shiftShapes(mode.startShapes, delta),
        startConnectedLineShapes: mode.startConnectedLineShapes.map((shapeObj) => ({
          ...shapeObj,
          shape: shiftShape(shapeObj.shape, delta),
        })),
      };
    case "RESIZE":
      return {
        ...mode,
        resizePoint: shiftCoords(mode.resizePoint, delta),
        startShape: shiftShape(mode.startShape, delta),
      };
    case "RESIZE_MULTI":
      return {
        ...mode,
        startShapes: shiftShapes(mode.startShapes, delta),
        startBounds: shiftBoundingBox(mode.startBounds, delta),
        anchor: shiftCoords(mode.anchor, delta),
      };
    case "TEXT_EDIT":
      return {
        ...mode,
        startShape: shiftShape(mode.startShape, delta) as TextShape,
      };
    case "LINE_TEXT_EDIT":
    case "RECTANGLE_TEXT_EDIT":
    case "RECTANGLE_LABEL_EDIT":
      return mode;
  }
}

function extendCanvasToFitBounds(state: DiagramState, bounds: BoundingBox | null): Coords {
  if (!bounds) {
    return { r: 0, c: 0 };
  }

  const rowShift =
    bounds.top < 0 ? Math.abs(bounds.top) + AUTO_EXTEND_ROW_BUFFER : 0;
  const colShift =
    bounds.left < 0 ? Math.abs(bounds.left) + AUTO_EXTEND_COL_BUFFER : 0;
  const rowGrowth =
    bounds.bottom >= state.canvasSize.rows
      ? bounds.bottom - state.canvasSize.rows + 1 + AUTO_EXTEND_ROW_BUFFER
      : 0;
  const colGrowth =
    bounds.right >= state.canvasSize.cols
      ? bounds.right - state.canvasSize.cols + 1 + AUTO_EXTEND_COL_BUFFER
      : 0;

  if (rowShift === 0 && colShift === 0 && rowGrowth === 0 && colGrowth === 0) {
    return { r: 0, c: 0 };
  }

  const delta = { r: rowShift, c: colShift };
  state.canvasSize = {
    rows: state.canvasSize.rows + rowShift + rowGrowth,
    cols: state.canvasSize.cols + colShift + colGrowth,
  };

  if (rowShift !== 0 || colShift !== 0) {
    state.shapes = state.shapes.map((shapeObj) => shiftShapeObject(shapeObj, delta));
    state.currentHoveredCell = state.currentHoveredCell
      ? shiftCoords(state.currentHoveredCell, delta)
      : null;
    state.textCursorCell = state.textCursorCell
      ? shiftCoords(state.textCursorCell, delta)
      : null;
    state.mode = shiftActionMode(state.mode, delta);
    queuePendingCanvasScroll(state, delta);
  }

  return delta;
}

function extendCanvasToFitShapes(state: DiagramState, shapes: Shape[]): Coords {
  return extendCanvasToFitBounds(state, getBoundingBoxOfAll(shapes));
}

function getConnectedBoundLineStartShapes(
  shapeObjects: ShapeObject[],
  movedShapeIds: string[],
): { id: string; shape: Shape }[] {
  if (movedShapeIds.length === 0) {
    return [];
  }

  const movedShapeIdSet = new Set(movedShapeIds);
  return shapeObjects
    .filter(
      (shapeObj) =>
        isLineLikeShape(shapeObj.shape) &&
        !movedShapeIdSet.has(shapeObj.id) &&
        movedShapeIds.some((shapeId) => isLineBoundToShape(shapeObj.shape, shapeId)),
    )
    .map((shapeObj) => ({
      id: shapeObj.id,
      shape: _.cloneDeep(shapeObj.shape),
    }));
}

function syncBoundLineShapes(state: DiagramState, targetShapeIds: string[]): void {
  if (targetShapeIds.length === 0) {
    return;
  }

  const shapeIdSet = new Set(targetShapeIds);
  const shapeLookup = new Map(state.shapes.map((shapeObj) => [shapeObj.id, shapeObj.shape]));

  state.shapes = state.shapes.map((shapeObj) => {
    if (!isLineLikeShape(shapeObj.shape)) {
      return shapeObj;
    }
    if (!targetShapeIds.some((shapeId) => isLineBoundToShape(shapeObj.shape, shapeId))) {
      return shapeObj;
    }

    const reboundShape = applyShapeBindings(shapeObj.shape, shapeLookup);
    shapeLookup.set(shapeObj.id, reboundShape);
    return {
      ...shapeObj,
      shape: reboundShape,
    };
  });
}

function detachLineBindings(shape: Shape): Shape {
  if (!isLineLikeShape(shape)) {
    return shape;
  }

  return {
    ...shape,
    startBinding: undefined,
    endBinding: undefined,
  };
}

function syncBoundLineShapesForTranslation(
  state: DiagramState,
  movedShapeIds: string[],
  delta: Coords,
  startConnectedLineShapes: { id: string; shape: Shape }[],
): void {
  if (movedShapeIds.length === 0 || (delta.r === 0 && delta.c === 0)) {
    return;
  }

  const movedShapeIdSet = new Set(movedShapeIds);
  const selectedShapeIdSet =
    state.mode.M === "MOVE" ? new Set(state.mode.shapeIds) : new Set<string>();
  const startLineShapeLookup = new Map(
    startConnectedLineShapes.map((shapeObj) => [shapeObj.id, shapeObj.shape]),
  );
  const shapeLookup = new Map(state.shapes.map((shapeObj) => [shapeObj.id, shapeObj.shape]));

  state.shapes = state.shapes.map((shapeObj) => {
    if (!isLineLikeShape(shapeObj.shape)) {
      return shapeObj;
    }
    if (selectedShapeIdSet.has(shapeObj.id)) {
      return shapeObj;
    }

    const startMoved =
      shapeObj.shape.startBinding &&
      movedShapeIdSet.has(shapeObj.shape.startBinding.targetShapeId);
    const endMoved =
      shapeObj.shape.endBinding &&
      movedShapeIdSet.has(shapeObj.shape.endBinding.targetShapeId);
    if (!startMoved && !endMoved) {
      return shapeObj;
    }

    const hasSingleBinding = Boolean(shapeObj.shape.startBinding) !== Boolean(shapeObj.shape.endBinding);
    const movedBothBoundEndpoints = Boolean(startMoved && endMoved);
    const baseShape = (startLineShapeLookup.get(shapeObj.id) ?? shapeObj.shape) as Line | MultiSegment;

    if (hasSingleBinding || movedBothBoundEndpoints) {
      const translatedShape = translateUnbounded(baseShape, delta) as Line | MultiSegment;
      shapeLookup.set(shapeObj.id, translatedShape);
      return {
        ...shapeObj,
        shape: translatedShape,
      };
    }

    const reboundShape = applyShapeBindings(baseShape, shapeLookup);
    shapeLookup.set(shapeObj.id, reboundShape);
    return {
      ...shapeObj,
      shape: reboundShape,
    };
  });
}

function getLineResizeHandle(
  shape: Line | MultiSegment,
  resizePoint: Coords,
): "START" | "END" | null {
  const hit = getResizePoints(shape).find((point) => _.isEqual(point.coords, resizePoint));
  if (!hit) {
    return null;
  }
  return hit.name === "START" || hit.name === "END" ? hit.name : null;
}

function resolveLineBindingsForResize(
  state: DiagramState,
  shape: Line | MultiSegment,
  resizeHandle: "START" | "END" | null,
): Line | MultiSegment {
  if (shape.type === "LINE") {
    return {
      ...shape,
      startBinding:
        resizeHandle === "START"
          ? bindLineEndpointAtCoords(state.shapes, shape.start)
          : shape.startBinding,
      endBinding:
        resizeHandle === "END"
          ? bindLineEndpointAtCoords(state.shapes, shape.end)
          : shape.endBinding,
    };
  }

  const firstSegment = shape.segments[0];
  const lastSegment = shape.segments[shape.segments.length - 1];
  return {
    ...shape,
    startBinding:
      resizeHandle === "START" && firstSegment
        ? bindLineEndpointAtCoords(state.shapes, firstSegment.start)
        : shape.startBinding,
    endBinding:
      resizeHandle === "END" && lastSegment && !shape.closed
        ? bindLineEndpointAtCoords(state.shapes, lastSegment.end)
        : shape.closed
        ? undefined
        : shape.endBinding,
  };
}

function withResolvedLineBindings(state: DiagramState, shape: Shape): Shape {
  if (!isLineLikeShape(shape)) {
    return shape;
  }

  const shapeLookup = new Map(state.shapes.map((shapeObj) => [shapeObj.id, shapeObj.shape]));

  if (shape.type === "LINE") {
    const resolvedShape = {
      ...shape,
      startBinding: shape.startBinding,
      endBinding: bindLineEndpointAtCoords(state.shapes, shape.end),
    };
    return applyShapeBindings(resolvedShape, shapeLookup);
  }

  const lastSegment = shape.segments[shape.segments.length - 1];
  const resolvedShape = {
    ...shape,
    startBinding: shape.startBinding,
    endBinding: shape.closed
      ? undefined
      : lastSegment
      ? bindLineEndpointAtCoords(state.shapes, lastSegment.end)
      : shape.endBinding,
  };
  return applyShapeBindings(resolvedShape, shapeLookup);
}

function shouldCloseMultiSegmentLine(shape: MultiSegment): boolean {
  if (shape.segments.length < 3) {
    return false;
  }

  const firstSegment = shape.segments[0];
  const lastSegment = shape.segments[shape.segments.length - 1];

  return _.isEqual(lastSegment.end, firstSegment.start);
}

function removeMultiSegmentPoint(
  shape: MultiSegment,
  pointIndex: number,
): MultiSegment | null {
  if (shape.closed || shape.segments.length < 2) {
    return null;
  }
  if (pointIndex < 0 || pointIndex >= shape.segments.length - 1) {
    return null;
  }

  const leftSegment = shape.segments[pointIndex];
  const rightSegment = shape.segments[pointIndex + 1];
  if (!leftSegment || !rightSegment) {
    return null;
  }

  const alternateElbow =
    leftSegment.axis === "HORIZONTAL" && rightSegment.axis === "VERTICAL"
      ? { r: rightSegment.end.r, c: leftSegment.start.c }
      : leftSegment.axis === "VERTICAL" && rightSegment.axis === "HORIZONTAL"
      ? { r: leftSegment.start.r, c: rightSegment.end.c }
      : null;

  const replacementSegments =
    alternateElbow == null
      ? [createLineSegment(leftSegment.start, rightSegment.end)]
      : [
          createLineSegment(leftSegment.start, alternateElbow),
          createLineSegment(alternateElbow, rightSegment.end),
        ];
  const nextShape = normalizeMultiSegmentLine({
    ...shape,
    segments: [
      ...shape.segments.slice(0, pointIndex),
      ...replacementSegments,
      ...shape.segments.slice(pointIndex + 2),
    ],
  });

  return nextShape.segments.length > 0 ? nextShape : null;
}

function getActiveSelectionShapeIds(state: DiagramState): string[] {
  if (state.mode.M === "SELECT" || state.mode.M === "SELECT_DRAG") {
    return state.mode.shapeIds;
  }
  if (state.mode.M === "MOVE") {
    return state.mode.shapeIds;
  }
  if (state.mode.M === "RESIZE") {
    return [state.mode.shapeId];
  }
  if (state.mode.M === "RESIZE_MULTI") {
    return state.mode.shapeIds;
  }
  if (
    state.mode.M === "TEXT_EDIT" ||
    state.mode.M === "LINE_TEXT_EDIT" ||
    state.mode.M === "RECTANGLE_TEXT_EDIT" ||
    state.mode.M === "RECTANGLE_LABEL_EDIT"
  ) {
    return [state.mode.shapeId];
  }
  return [];
}

function getVisualSelectionOrder(shapes: ShapeObject[]): string[] {
  return shapes
    .map((shapeObj, index) => {
      const bounds = getBoundingBox(shapeObj.shape);
      return {
        id: shapeObj.id,
        index,
        top: bounds.top,
        left: bounds.left,
        bottom: bounds.bottom,
        right: bounds.right,
      };
    })
    .sort((a, b) => {
      if (a.top !== b.top) return a.top - b.top;
      if (a.left !== b.left) return a.left - b.left;
      if (a.bottom !== b.bottom) return a.bottom - b.bottom;
      if (a.right !== b.right) return a.right - b.right;
      return a.index - b.index;
    })
    .map((entry) => entry.id);
}

function finalizeMultiSegmentShape(state: DiagramState, shape: MultiSegment): MultiSegment {
  const normalizedShape = normalizeMultiSegmentLine(shape);
  const closedShape = shouldCloseMultiSegmentLine(normalizedShape)
    ? normalizeMultiSegmentLine({
        ...normalizedShape,
        closed: true,
        endBinding: undefined,
      })
    : {
        ...normalizedShape,
        closed: false,
      };

  return withResolvedLineBindings(state, closedShape) as MultiSegment;
}

function isTextShapeEmpty(shape: TextShape): boolean {
  return shape.lines.length === 0 || shape.lines.every((line) => line.length === 0);
}

function alignTextLines(
  lines: string[],
  align: "LEFT" | "CENTER" | "RIGHT"
): string[] {
  const trimmedLines = lines.map((line) => line.trim());
  const width = Math.max(1, ...trimmedLines.map((line) => Array.from(line).length));

  return trimmedLines.map((line) => {
    const lineLength = Array.from(line).length;
    const remaining = Math.max(0, width - lineLength);
    if (align === "RIGHT") {
      return `${" ".repeat(remaining)}${line}`;
    }
    if (align === "CENTER") {
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      return `${" ".repeat(left)}${line}${" ".repeat(right)}`;
    }
    return line;
  });
}

function tryToggleCheckboxAtCoords(
  state: DiagramState,
  shapeObj: ShapeObject,
  coords: Coords
): boolean {
  if (shapeObj.shape.type === "TEXT") {
    const lineIndex = coords.r - shapeObj.shape.start.r;
    if (lineIndex < 0 || lineIndex >= shapeObj.shape.lines.length) {
      return false;
    }
    const line = shapeObj.shape.lines[lineIndex] ?? "";
    const nextLine = toggleCheckboxAtIndex(line, coords.c - shapeObj.shape.start.c);
    if (nextLine == null || nextLine === line) {
      return false;
    }
    shapeObj.shape = {
      ...shapeObj.shape,
      lines: shapeObj.shape.lines.map((entry, index) =>
        index === lineIndex ? nextLine : entry
      ),
    };
    return true;
  }

  if (shapeObj.shape.type !== "RECTANGLE") {
    return false;
  }

  const labelLines = shapeObj.shape.labelLines ?? [];
  if (labelLines.length === 0) {
    return false;
  }

  const alignH =
    shapeObj.style?.rectangleTextAlignH ?? state.globalStyle.rectangleTextAlignH;
  const alignV =
    shapeObj.style?.rectangleTextAlignV ?? state.globalStyle.rectangleTextAlignV;
  const overflow =
    shapeObj.style?.rectangleTextOverflow ?? state.globalStyle.rectangleTextOverflow;
  const padding =
    shapeObj.style?.rectangleTextPadding ?? state.globalStyle.rectangleTextPadding;

  const positioned = layoutRectangleLabelLines(shapeObj.shape, labelLines, {
    alignH,
    alignV,
    overflow,
    padding,
  });
  const visualLineIndex = positioned.findIndex(({ row, col, text }) => {
    const width = Array.from(text).length;
    return row === coords.r && coords.c >= col && coords.c < col + width;
  });

  if (visualLineIndex < 0 || visualLineIndex >= labelLines.length) {
    return false;
  }

  const sourceLine = labelLines[visualLineIndex] ?? "";
  const visualLine = positioned[visualLineIndex];
  if (!visualLine) {
    return false;
  }

  const nextLine = toggleCheckboxAtIndex(sourceLine, coords.c - visualLine.col);
  if (nextLine == null || nextLine === sourceLine) {
    return false;
  }

  shapeObj.shape = {
    ...shapeObj.shape,
    labelLines: labelLines.map((entry, index) =>
      index === visualLineIndex ? nextLine : entry
    ),
  };
  return true;
}

function getTextRectangleStyleOverride(): Partial<Style> {
  return {
    rectangleBorder: "NONE",
    rectangleTextAlignH: "CENTER",
    rectangleTextAlignV: "MIDDLE",
  };
}

function getRectangleCreationStyleOverride(): Partial<Style> {
  return {
    rectangleTextAlignH: "CENTER",
    rectangleTextAlignV: "MIDDLE",
  };
}

function completeTextCreation(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "CREATE" || state.mode.shape.type !== "TEXT") return;

  const createdShape = state.mode.shape;
  if (isTextShapeEmpty(createdShape)) {
    state.textCursorCell = null;
    if (opts.goToSelect) {
      state.selectedTool = "SELECT";
      state.mode = { M: "SELECT", shapeIds: [] };
    } else {
      state.mode = { M: "BEFORE_CREATING" };
    }
    return;
  }

  const createdShapeId = addNewShape(state, createdShape);
  pushHistory(state);
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
    state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
  } else {
    state.mode = { M: "BEFORE_CREATING" };
  }
  state.textCursorCell = null;
}

function completeTextToolCreation(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "CREATE") return;

  if (state.mode.shape.type === "TEXT") {
    completeTextCreation(state, opts);
    return;
  }

  if (state.mode.shape.type !== "RECTANGLE") return;

  const newShape: Shape | null = isShapeLegal(state.mode.shape) ? state.mode.shape : null;
  if (!newShape) {
    state.textCursorCell = null;
    if (opts.goToSelect) {
      state.selectedTool = "SELECT";
      state.mode = { M: "SELECT", shapeIds: [] };
    } else {
      state.mode = { M: "BEFORE_CREATING" };
    }
    return;
  }

  const createdShapeId = addNewShape(state, newShape, getTextRectangleStyleOverride());
  pushHistory(state);
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
    state.mode = { M: "SELECT", shapeIds: [createdShapeId] };
  } else {
    state.mode = {
      M: "RECTANGLE_TEXT_EDIT",
      shapeId: createdShapeId,
      startLines: [],
    };
  }
  state.textCursorCell = null;
}

function completeTextEditing(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "TEXT_EDIT") return;

  const textEditMode = state.mode;
  const selectedTextShapeObjIdx = state.shapes.findIndex(
    (s) => s.id === textEditMode.shapeId
  );

  if (selectedTextShapeObjIdx < 0) {
    state.mode = { M: "SELECT", shapeIds: [] };
    if (opts.goToSelect) state.selectedTool = "SELECT";
    state.textCursorCell = null;
    return;
  }

  const selectedTextShapeObj = state.shapes[selectedTextShapeObjIdx];
  const selectedTextShape = selectedTextShapeObj.shape as TextShape;
  const changed = !_.isEqual(selectedTextShape, textEditMode.startShape);

  let nextSelection: string[] = [textEditMode.shapeId];
  if (isTextShapeEmpty(selectedTextShape)) {
    state.shapes.splice(selectedTextShapeObjIdx, 1);
    nextSelection = [];
  }
  if (changed) {
    pushHistory(state);
  }

  state.mode = { M: "SELECT", shapeIds: nextSelection };
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
  }
  state.textCursorCell = null;
}

function refreshTextEditBaseline(state: DiagramState): void {
  if (state.mode.M === "TEXT_EDIT") {
    const mode = state.mode;
    const shapeObj = state.shapes.find((shape) => shape.id === mode.shapeId);
    if (!shapeObj || shapeObj.shape.type !== "TEXT") {
      state.mode = { M: "SELECT", shapeIds: [] };
      state.textCursorCell = null;
      return;
    }
    state.mode = {
      ...mode,
      startShape: _.cloneDeep(shapeObj.shape),
    };
    return;
  }

  if (state.mode.M === "LINE_TEXT_EDIT") {
    const mode = state.mode;
    const shapeObj = state.shapes.find((shape) => shape.id === mode.shapeId);
    if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
      state.mode = { M: "SELECT", shapeIds: [] };
      state.textCursorCell = null;
      return;
    }
    state.mode = {
      ...mode,
      startLines: _.cloneDeep(getLineLabelLines(shapeObj.shape)),
    };
    return;
  }

  if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
    const mode = state.mode;
    const shapeObj = state.shapes.find((shape) => shape.id === mode.shapeId);
    if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
      state.mode = { M: "SELECT", shapeIds: [] };
      state.textCursorCell = null;
      return;
    }
    state.mode = {
      ...mode,
      startLines: _.cloneDeep(shapeObj.shape.labelLines ?? []),
    };
    return;
  }

  if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
    const mode = state.mode;
    const shapeObj = state.shapes.find((shape) => shape.id === mode.shapeId);
    if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
      state.mode = { M: "SELECT", shapeIds: [] };
      state.textCursorCell = null;
      return;
    }
    state.mode = {
      ...mode,
      startLabel: shapeObj.shape.label ?? "",
    };
  }
}

function applyUpdatedTextValue(state: DiagramState, value: string): void {
  if (state.mode.M === "CREATE" && state.mode.shape.type === "TEXT") {
    state.mode.shape.lines = capText(
      state.mode.shape.start,
      getLines(value),
      state.canvasSize
    );
  } else if (state.mode.M === "TEXT_EDIT") {
    const textEditMode = state.mode;

    const selectedTextShapeObjIdx = state.shapes.findIndex(
      (s) => s.id === textEditMode.shapeId
    );

    const selectTextShape = state.shapes[selectedTextShapeObjIdx]
      ?.shape as TextShape | undefined;

    if (!selectTextShape) return;

    selectTextShape.lines = capText(
      selectTextShape.start,
      getLines(value),
      state.canvasSize
    );
    syncBoundLineShapes(state, [textEditMode.shapeId]);
  } else if (state.mode.M === "LINE_TEXT_EDIT") {
    const editMode = state.mode;
    const shapeObj = state.shapes.find((shape) => shape.id === editMode.shapeId);
    if (!shapeObj || !isLineLikeShape(shapeObj.shape)) return;
    shapeObj.shape = {
      ...shapeObj.shape,
      labelLines: mergeLineLabelInput(value),
    } as Line | MultiSegment;
  } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
    const editMode = state.mode;
    const rectShapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
    if (rectShapeObj?.shape.type !== "RECTANGLE") return;
    const nextLines = getLines(value);
    rectShapeObj.shape = {
      ...rectShapeObj.shape,
      labelLines: nextLines,
    };
  } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
    const editMode = state.mode;
    const rectShapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
    if (rectShapeObj?.shape.type !== "RECTANGLE") return;
    rectShapeObj.shape = {
      ...rectShapeObj.shape,
      label: getLines(value)[0] ?? "",
    };
  }
}

function completeLineTextEditing(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "LINE_TEXT_EDIT") return;

  const editMode = state.mode;
  const shapeObj = state.shapes.find((shape) => shape.id === editMode.shapeId);
  if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
    state.mode = { M: "SELECT", shapeIds: [] };
    if (opts.goToSelect) state.selectedTool = "SELECT";
    state.textCursorCell = null;
    return;
  }

  const currentLines = getLineLabelLines(shapeObj.shape);
  const changed = !_.isEqual(currentLines, editMode.startLines);

  if (currentLines.length === 0) {
    shapeObj.shape = {
      ...shapeObj.shape,
      labelLines: [],
    } as Line | MultiSegment;
  }

  if (changed) {
    pushHistory(state);
  }

  state.mode = { M: "SELECT", shapeIds: [editMode.shapeId] };
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
  }
  state.textCursorCell = null;
}

function completeRectangleTextEditing(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "RECTANGLE_TEXT_EDIT") return;

  const editMode = state.mode;
  const rectShapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
  if (!rectShapeObj || rectShapeObj.shape.type !== "RECTANGLE") {
    state.mode = { M: "SELECT", shapeIds: [] };
    if (opts.goToSelect) state.selectedTool = "SELECT";
    state.textCursorCell = null;
    return;
  }

  const currentLines = rectShapeObj.shape.labelLines ?? [];
  const changed = !_.isEqual(currentLines, editMode.startLines);
  const mergedStyle = {
    ...defaultStyle(),
    ...state.globalStyle,
    ...(rectShapeObj.style ?? {}),
  };
  const isInvisibleEmptyTextBox =
    currentLines.every((line) => line.length === 0) &&
    resolveRectangleBorder(mergedStyle) === "NONE" &&
    mergedStyle.rectangleFill === "NONE";

  if (currentLines.length === 0 || currentLines.every((line) => line.length === 0)) {
    rectShapeObj.shape = {
      ...rectShapeObj.shape,
      labelLines: [],
    };
  }

  if (isInvisibleEmptyTextBox) {
    state.shapes = state.shapes.filter((shape) => shape.id !== editMode.shapeId);
    if (changed) {
      pushHistory(state);
    }
    state.mode = { M: "SELECT", shapeIds: [] };
    if (opts.goToSelect) {
      state.selectedTool = "SELECT";
    }
    state.textCursorCell = null;
    return;
  }

  if (changed) {
    pushHistory(state);
  }

  state.mode = { M: "SELECT", shapeIds: [editMode.shapeId] };
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
  }
  state.textCursorCell = null;
}

function completeRectangleLabelEditing(
  state: DiagramState,
  opts: { goToSelect: boolean }
): void {
  if (state.mode.M !== "RECTANGLE_LABEL_EDIT") return;

  const editMode = state.mode;
  const rectShapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
  if (!rectShapeObj || rectShapeObj.shape.type !== "RECTANGLE") {
    state.mode = { M: "SELECT", shapeIds: [] };
    if (opts.goToSelect) state.selectedTool = "SELECT";
    state.textCursorCell = null;
    return;
  }

  const currentLabel = rectShapeObj.shape.label ?? "";
  const changed = currentLabel !== editMode.startLabel;
  const trimmedLabel = currentLabel.trim();

  rectShapeObj.shape = {
    ...rectShapeObj.shape,
    label: trimmedLabel.length > 0 ? currentLabel : undefined,
  };

  if (changed) {
    pushHistory(state);
  }

  state.mode = { M: "SELECT", shapeIds: [editMode.shapeId] };
  if (opts.goToSelect) {
    state.selectedTool = "SELECT";
  }
  state.textCursorCell = null;
}

function addNewShape(
  state: DiagramState,
  shape: Shape,
  style?: Partial<Style>
): string {
  const id = uuidv4();
  const newShapeObj: ShapeObject = {
    id,
    shape,
    style: _.cloneDeep(style ?? state.globalStyle),
  };

  // New shapes are added on top by default, regardless of shape type.
  state.shapes.push(newShapeObj);

  return id;
}

function replaceShape(
  state: DiagramState,
  shapeId: string,
  shape: Shape
): void {
  const idx = state.shapes.findIndex((s) => s.id === shapeId);
  state.shapes[idx].shape = shape;
}

function deleteShapes(state: DiagramState, shapeIds: string[]): void {
  shapeIds.forEach((shapeId) => {
    const shapeIdx = state.shapes.findIndex((s) => s.id === shapeId);
    if (shapeIdx >= 0) {
      state.shapes.splice(shapeIdx, 1);
    }
  });
  state.groups = state.groups
    .map((group) => ({
      ...group,
      shapeIds: group.shapeIds.filter((shapeId) => !shapeIds.includes(shapeId)),
    }))
    .filter((group) => group.shapeIds.length > 1);
}

function pushHistory(state: DiagramState): void {
  const { canvasSize, shapes, groups, portalViews, styleMode, globalStyle } = state;
  state.history = [
    ...state.history.slice(0, state.historyIdx + 1),
    _.cloneDeep({ canvasSize, shapes, groups, portalViews, styleMode, globalStyle }),
  ];

  state.historyIdx++;
}

function undoHistory(state: DiagramState): void {
  if (state.historyIdx > 0) {
    const { canvasSize, shapes, groups, portalViews, styleMode, globalStyle } = _.cloneDeep(
      state.history[state.historyIdx - 1]
    );
    state.canvasSize = canvasSize;
    state.shapes = shapes;
    state.groups = groups;
    state.portalViews = portalViews;
    state.styleMode = styleMode;
    state.globalStyle = globalStyle;

    state.historyIdx--;
  }
}

function redoHistory(state: DiagramState): void {
  if (state.historyIdx < state.history.length - 1) {
    const { canvasSize, shapes, groups, portalViews, styleMode, globalStyle } = _.cloneDeep(
      state.history[state.historyIdx + 1]
    );
    state.canvasSize = canvasSize;
    state.shapes = shapes;
    state.groups = groups;
    state.portalViews = portalViews;
    state.styleMode = styleMode;
    state.globalStyle = globalStyle;

    state.historyIdx++;
  }
}
//#endregion

//#region Utilities
function toShapeObjects(
  shapes: ShapeObject[],
  shapeIds: string[]
): ShapeObject[] {
  return shapeIds.map((shapeId) => shapes.find((s) => s.id === shapeId)!);
}

function toShapeObject(shapes: ShapeObject[], shapeId: string): ShapeObject {
  return shapes.find((s) => s.id === shapeId)!;
}

function getGroupByShapeId(
  state: DiagramState,
  shapeId: string
): ShapeGroup | null {
  return state.groups.find((group) => group.shapeIds.includes(shapeId)) ?? null;
}

function expandSelectionWithGroups(
  state: DiagramState,
  shapeIds: string[]
): string[] {
  const nextIds = new Set<string>();
  shapeIds.forEach((shapeId) => {
    const group = getGroupByShapeId(state, shapeId);
    if (group) {
      group.shapeIds.forEach((memberId) => nextIds.add(memberId));
      return;
    }
    nextIds.add(shapeId);
  });
  return Array.from(nextIds);
}

function getBoundingBoxAnchorForHandle(
  bounds: BoundingBox,
  handle: BoundingBoxHandle
): Coords {
  switch (handle) {
    case "TL":
      return { r: bounds.bottom, c: bounds.right };
    case "TR":
      return { r: bounds.bottom, c: bounds.left };
    case "BR":
      return { r: bounds.top, c: bounds.left };
    case "BL":
      return { r: bounds.top, c: bounds.right };
  }
}

function getBoundingBoxFromAnchorAndPointer(
  anchor: Coords,
  pointer: Coords
): BoundingBox {
  return {
    top: Math.min(anchor.r, pointer.r),
    bottom: Math.max(anchor.r, pointer.r),
    left: Math.min(anchor.c, pointer.c),
    right: Math.max(anchor.c, pointer.c),
  };
}

function scaleCoordWithinBounds(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number
): number {
  const sourceSpan = sourceMax - sourceMin;
  if (sourceSpan === 0) {
    return Math.round(targetMin);
  }

  const ratio = (value - sourceMin) / sourceSpan;
  return Math.round(targetMin + ratio * (targetMax - targetMin));
}

function scaleCoordsWithinBounds(
  coords: Coords,
  sourceBounds: BoundingBox,
  targetBounds: BoundingBox
): Coords {
  return {
    r: scaleCoordWithinBounds(
      coords.r,
      sourceBounds.top,
      sourceBounds.bottom,
      targetBounds.top,
      targetBounds.bottom
    ),
    c: scaleCoordWithinBounds(
      coords.c,
      sourceBounds.left,
      sourceBounds.right,
      targetBounds.left,
      targetBounds.right
    ),
  };
}

function resizeShapeGroup(
  shapes: Shape[],
  sourceBounds: BoundingBox,
  targetBounds: BoundingBox,
  canvasSize: CanvasSize
): Shape[] {
  return shapes.map((shape) =>
    resizeShapeWithinBounds(shape, sourceBounds, targetBounds, canvasSize)
  );
}

function resizeShapeWithinBounds(
  shape: Shape,
  sourceBounds: BoundingBox,
  targetBounds: BoundingBox,
  canvasSize: CanvasSize
): Shape {
  const scaledShape = scaleShapeWithinBounds(shape, sourceBounds, targetBounds);
  if (isShapeWithinCanvas(scaledShape, canvasSize) && isShapeLegal(scaledShape)) {
    return scaledShape;
  }
  return shape;
}

function scaleShapeWithinBounds(
  shape: Shape,
  sourceBounds: BoundingBox,
  targetBounds: BoundingBox
): Shape {
  switch (shape.type) {
    case "RECTANGLE": {
      const newTl = scaleCoordsWithinBounds(shape.tl, sourceBounds, targetBounds);
      const newBr = scaleCoordsWithinBounds(shape.br, sourceBounds, targetBounds);
      const [tl, br] = normalizeTlBr(newTl, newBr);
      return { ...shape, tl, br };
    }
    case "LINE": {
      const start = scaleCoordsWithinBounds(
        shape.start,
        sourceBounds,
        targetBounds
      );
      const end = scaleCoordsWithinBounds(shape.end, sourceBounds, targetBounds);
      if (shape.axis === "HORIZONTAL") {
        const direction =
          start.c <= end.c ? "LEFT_TO_RIGHT" : "RIGHT_TO_LEFT";
        return { ...shape, start: { ...start, r: start.r }, end: { ...end, r: start.r }, direction };
      }
      const direction = start.r <= end.r ? "DOWN" : "UP";
      return { ...shape, start: { ...start, c: start.c }, end: { ...end, c: start.c }, direction };
    }
    case "MULTI_SEGMENT_LINE": {
      if (shape.segments.length === 0) {
        return shape;
      }

      let curr = scaleCoordsWithinBounds(
        shape.segments[0].start,
        sourceBounds,
        targetBounds
      );
      const scaledSegments = shape.segments.map((segment) => {
        if (segment.axis === "HORIZONTAL") {
          const scaledEndCol = scaleCoordWithinBounds(
            segment.end.c,
            sourceBounds.left,
            sourceBounds.right,
            targetBounds.left,
            targetBounds.right
          );
          const next = { r: curr.r, c: scaledEndCol };
          const scaled = {
            ...segment,
            start: curr,
            end: next,
            direction:
              curr.c <= next.c ? ("LEFT_TO_RIGHT" as const) : ("RIGHT_TO_LEFT" as const),
          };
          curr = next;
          return scaled;
        }

        const scaledEndRow = scaleCoordWithinBounds(
          segment.end.r,
          sourceBounds.top,
          sourceBounds.bottom,
          targetBounds.top,
          targetBounds.bottom
        );
        const next = { r: scaledEndRow, c: curr.c };
        const scaled = {
          ...segment,
          start: curr,
          end: next,
          direction: curr.r <= next.r ? ("DOWN" as const) : ("UP" as const),
        };
        curr = next;
        return scaled;
      });

      return normalizeMultiSegmentLine({
        ...shape,
        segments: scaledSegments,
      });
    }
    case "TEXT": {
      return {
        ...shape,
        start: scaleCoordsWithinBounds(shape.start, sourceBounds, targetBounds),
      };
    }
  }
}

function isShapeWithinCanvas(shape: Shape, canvasSize: CanvasSize): boolean {
  const bb = getBoundingBoxOfAll([shape]);
  if (!bb) return false;
  return (
    bb.top >= 0 &&
    bb.left >= 0 &&
    bb.bottom < canvasSize.rows &&
    bb.right < canvasSize.cols
  );
}

//#endregion

export const diagramReducer = diagramSlice.reducer;
export const diagramActions = diagramSlice.actions;
