import { createSelector } from "@reduxjs/toolkit";
import {
  getBoundingBoxOfAll,
  getBoundingBoxResizeHandleAtCoords,
  getShapeObjAtCoords,
  getShapeObjAtCoordsPreferSelected,
  hasResizePointAtCoords,
  isShapeObjDragSurfaceAtCoords,
  isShapeObjAtCoords,
} from "../models/shapeInCanvas";

import { RootState } from "./store";
import { DiagramState, ShapeObject } from "./diagramSlice";
import { Shape, TextShape } from "../models/shapes";
import {
  getRectangleBorderLabelEditorTextShape,
  getRectangleLabelEditorTextShape,
} from "../models/rectangleText";
import { defaultStyle } from "../models/style";
import {
  getLineLabelEditorTextShape,
  isLineLikeShape,
} from "../models/lineFeatures";

//#region diagramSlice selectors
const hasSelectedShape = createSelector(
  [(state: DiagramState) => state],
  (state): boolean => {
    if (state.mode.M === "SELECT") {
      return state.mode.shapeIds.length > 0;
    } else if (state.mode.M === "MOVE") {
      return state.mode.shapeIds.length > 0;
    } else if (state.mode.M === "RESIZE") {
      return true;
    } else if (state.mode.M === "RESIZE_MULTI") {
      return state.mode.shapeIds.length > 0;
    } else if (state.mode.M === "TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "LINE_TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
      return true;
    }

    return false;
  }
);

const hasSingleSelectedShape = createSelector(
  [(state: DiagramState) => state],
  (state): boolean => {
    if (state.mode.M === "SELECT") {
      return state.mode.shapeIds.length === 1;
    } else if (state.mode.M === "MOVE") {
      return state.mode.shapeIds.length === 1;
    } else if (state.mode.M === "RESIZE") {
      return true;
    } else if (state.mode.M === "RESIZE_MULTI") {
      return state.mode.shapeIds.length === 1;
    } else if (state.mode.M === "TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "LINE_TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
      return true;
    } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
      return true;
    }

    return false;
  }
);

const selectedShapeObjs = createSelector(
  [(state: DiagramState) => state],
  (state): ShapeObject[] => {
    if (state.mode.M === "SELECT" || state.mode.M === "SELECT_DRAG") {
      return state.mode.shapeIds
        .map((shapeId) => state.shapes.find((shape) => shape.id === shapeId))
        .filter((shapeObj): shapeObj is ShapeObject => shapeObj != null);
    } else if (state.mode.M === "MOVE") {
      return state.mode.shapeIds
        .map((shapeId) => state.shapes.find((shape) => shape.id === shapeId))
        .filter((shapeObj): shapeObj is ShapeObject => shapeObj != null);
    } else if (state.mode.M === "RESIZE") {
      const resizeMode = state.mode;
      return state.shapes
        .filter((shape) => shape.id === resizeMode.shapeId);
    } else if (state.mode.M === "RESIZE_MULTI") {
      return state.mode.shapeIds
        .map((shapeId) => state.shapes.find((shape) => shape.id === shapeId))
        .filter((shapeObj): shapeObj is ShapeObject => shapeObj != null);
    } else if (state.mode.M === "TEXT_EDIT") {
      const textEditMode = state.mode;
      return state.shapes
        .filter((shape) => shape.id === textEditMode.shapeId);
    } else if (state.mode.M === "LINE_TEXT_EDIT") {
      const lineTextEditMode = state.mode;
      return state.shapes
        .filter((shape) => shape.id === lineTextEditMode.shapeId);
    } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
      const rectangleTextEditMode = state.mode;
      return state.shapes
        .filter((shape) => shape.id === rectangleTextEditMode.shapeId);
    } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
      const rectangleLabelEditMode = state.mode;
      return state.shapes
        .filter((shape) => shape.id === rectangleLabelEditMode.shapeId);
    } else {
      return [];
    }
  }
);

const selectedShapeIds = createSelector(
  [(state: DiagramState) => state],
  (state): string[] => {
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
);

const selectedShapeObj = createSelector(
  [(state: DiagramState) => state],
  (state): ShapeObject | undefined => {
    const selectedShapes = selectedShapeObjs(state);
    if (selectedShapes.length === 0) {
      return undefined;
    } else if (selectedShapes.length > 1) {
      throw new Error("There's more than 1 selected shape");
    } else return selectedShapes[0];
  }
);

const currentCreatedShape = createSelector(
  [(state: DiagramState) => state],
  (state): Shape | undefined => {
    if (state.mode.M === "CREATE") return state.mode.shape;
    else return undefined;
  }
);

const currentEditedText = createSelector(
  [(state: DiagramState) => state],
  (state): TextShape | undefined => {
    if (state.mode.M === "CREATE" && state.mode.shape.type === "TEXT") {
      return state.mode.shape;
    } else if (state.mode.M === "TEXT_EDIT") {
      const selectedShapeId = state.mode.shapeId;
      const selectedTextShapeObj = state.shapes.find(
        (s) => s.id === selectedShapeId
      );

      return selectedTextShapeObj
        ? (selectedTextShapeObj.shape as TextShape)
        : undefined;
    } else if (state.mode.M === "RECTANGLE_TEXT_EDIT") {
      const editMode = state.mode;
      const shapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
      if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
        return undefined;
      }
      const mergedStyle = {
        ...defaultStyle(),
        ...state.globalStyle,
        ...(shapeObj.style ?? {}),
      };
      return getRectangleLabelEditorTextShape(
        shapeObj.shape,
        shapeObj.shape.labelLines ?? [],
        mergedStyle.rectangleTextPadding
      );
    } else if (state.mode.M === "RECTANGLE_LABEL_EDIT") {
      const editMode = state.mode;
      const shapeObj = state.shapes.find((s) => s.id === editMode.shapeId);
      if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
        return undefined;
      }
      return getRectangleBorderLabelEditorTextShape(
        shapeObj.shape,
        shapeObj.shape.label
      );
    } else if (state.mode.M === "LINE_TEXT_EDIT") {
      const editMode = state.mode;
      const shapeObj = state.shapes.find((shape) => shape.id === editMode.shapeId);
      if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
        return undefined;
      }
      const mergedStyle = {
        ...defaultStyle(),
        ...state.globalStyle,
        ...(shapeObj.style ?? {}),
      };
      return getLineLabelEditorTextShape(shapeObj.shape, {
        lineTextAlign: mergedStyle.lineTextAlign,
        lineTextPadding: mergedStyle.lineTextPadding,
      });
    } else {
      return undefined;
    }
  }
);

export type Pointer = "SELECT" | "MOVE" | "RESIZE" | "CREATE" | "NONE";
const getPointer = createSelector(
  [(state: DiagramState) => state],
  (state): Pointer => {
    if (state.mode.M === "BEFORE_CREATING" || state.mode.M === "CREATE")
      return "CREATE";

    if (state.mode.M === "MOVE") return "MOVE";
    if (state.mode.M === "RESIZE") return "RESIZE";
    if (state.mode.M === "RESIZE_MULTI") return "RESIZE";

    if (state.mode.M === "SELECT" && state.currentHoveredCell) {
      if (state.mode.shapeIds.length > 1) {
        const selectedShapes = state.mode.shapeIds
          .map((shapeId) => state.shapes.find((shape) => shape.id === shapeId)?.shape)
          .filter((shape): shape is Shape => shape != null);
        const selectedBounds = getBoundingBoxOfAll(selectedShapes);
        if (
          selectedBounds &&
          getBoundingBoxResizeHandleAtCoords(
            selectedBounds,
            state.currentHoveredCell
          )
        ) {
          return "RESIZE";
        }
      }

      const shapeObj = getShapeObjAtCoordsPreferSelected(
        state.shapes,
        state.currentHoveredCell,
        state.mode.shapeIds,
        state.globalStyle,
      );
      if (shapeObj) {
        // If I'm hovering a shape
        if (state.mode.shapeIds.includes(shapeObj.id)) {
          // If I'm hovering a selected shape
          if (state.mode.shapeIds.length === 1) {
            // If it's the only selected shape (I can either move or resize)
            if (
              hasResizePointAtCoords(shapeObj.shape, state.currentHoveredCell)
            ) {
              return "RESIZE";
            } else if (
              isShapeObjDragSurfaceAtCoords(shapeObj, state.currentHoveredCell, state.globalStyle)
            ) {
              return "MOVE";
            }
          } else {
            // Else there are other selected shapes (I can only move)
            return "MOVE";
          }
        } else {
          // Else I'm hovering an unselected shape
          return "SELECT";
        }
      }
    }

    return "NONE";
  }
);

//#endregion

//#region Root state selectors
const isShortcutsEnabled = createSelector(
  [(state: RootState) => state],
  (state): boolean => {
    return (
      state.app.createDiagramInProgress === false &&
      state.app.renameDiagramInProgress == null &&
      state.app.deleteDiagramInProgress == null &&
      !(
        state.diagram.mode.M === "CREATE" &&
        state.diagram.mode.shape.type === "TEXT"
      ) &&
      state.diagram.mode.M !== "TEXT_EDIT" &&
      state.diagram.mode.M !== "LINE_TEXT_EDIT" &&
      state.diagram.mode.M !== "RECTANGLE_TEXT_EDIT" &&
      state.diagram.mode.M !== "RECTANGLE_LABEL_EDIT"
    );
  }
);

const diagramIds = createSelector(
  [(state: RootState) => state.app.diagrams],
  (diagrams): string[] => diagrams.map((diagram) => diagram.id),
);

//#endregion
export const selectors = {
  hasSelectedShape,
  hasSingleSelectedShape,
  selectedShapeIds,
  selectedShapeObjs,
  selectedShapeObj,
  getPointer,
  isShortcutsEnabled,
  diagramIds,
  currentCreatedShape,
  currentEditedText,
};
