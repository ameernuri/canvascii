import { describe, expect, it } from "vitest";
import { editorInteractionActions } from "./editorInteractionActions";
import { createAsciipStore } from "./store";
import { appActions, initAppState } from "./appSlice";
import { layoutRectangleLabelLines } from "../models/rectangleText";
import type { Coords, Shape } from "../models/shapes";

function createLinePath(
  store: ReturnType<typeof createAsciipStore>,
  points: Coords[],
) {
  store.dispatch(editorInteractionActions.setTool("LINE"));
  store.dispatch(editorInteractionActions.pointerClick({ coords: points[0]! }));
  points.slice(1).forEach((point) => {
    store.dispatch(editorInteractionActions.pointerHover(point));
    store.dispatch(editorInteractionActions.pointerClick({ coords: point }));
  });
  store.dispatch(editorInteractionActions.completePolyline());
}

function getLineShape(shape: Shape): {
  start: Coords;
  end: Coords;
  type: "LINE" | "MULTI_SEGMENT_LINE";
  labelLines?: string[];
  startBinding?: { targetShapeId: string; side: string; position: number; locked?: boolean };
  endBinding?: { targetShapeId: string; side: string; position: number; locked?: boolean };
  segments?: { start: Coords; end: Coords }[];
} | null {
  if (shape.type === "LINE") {
    return {
      type: "LINE",
      start: shape.start,
      end: shape.end,
      labelLines: shape.labelLines,
      startBinding: shape.startBinding,
      endBinding: shape.endBinding,
    };
  }
  if (shape.type === "MULTI_SEGMENT_LINE") {
    return {
      type: "MULTI_SEGMENT_LINE",
      start: shape.segments[0]?.start ?? { r: 0, c: 0 },
      end: shape.segments[shape.segments.length - 1]?.end ?? { r: 0, c: 0 },
      labelLines: shape.labelLines,
      startBinding: shape.startBinding,
      endBinding: shape.endBinding,
      segments: shape.segments.map((segment) => ({ start: segment.start, end: segment.end })),
    };
  }
  return null;
}

describe("editorInteractionActions", () => {
  it("forwards interaction intents into the diagram reducers", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("TEXT"));
    store.dispatch(editorInteractionActions.pointerHover({ r: 3, c: 7 }));
    store.dispatch(editorInteractionActions.openExport());

    const state = store.getState();

    expect(state.diagram.selectedTool).toBe("TEXT");
    expect(state.diagram.currentHoveredCell).toEqual({ r: 3, c: 7 });
    expect(state.diagram.exportInProgress).toBe(true);
  });

  it("does not replace diagram state when setting the same text cursor twice", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTextCursor({ r: 4, c: 9 }));
    const previousDiagramState = store.getState().diagram;

    store.dispatch(editorInteractionActions.setTextCursor({ r: 4, c: 9 }));

    expect(store.getState().diagram).toBe(previousDiagramState);
  });

  it("emits committed state projections from commit-like interaction intents", () => {
    const committed: string[][] = [];
    const store = createAsciipStore({
      onCommittedState: ({ projection }) => {
        committed.push(projection.commands.map((command) => command.type));
      },
    });

    store.dispatch(appActions.createDiagram({ id: "diagram-2", name: "Diagram 2" }));
    store.dispatch(editorInteractionActions.expandCanvas());

    expect(committed.some((commandTypes) => commandTypes.includes("canvas.create"))).toBe(true);
    expect(committed.some((commandTypes) => commandTypes.includes("canvas.upsert"))).toBe(true);
    expect(store.getState().app.diagrams.find((diagram) => diagram.id === store.getState().app.activeDiagramId)?.data.canvasSize.rows).toBe(115);
  });

  it("uses command-first hydration for pointer-driven shape creation commits", () => {
    const committed: string[][] = [];
    const store = createAsciipStore({
      onCommittedState: ({ projection }) => {
        committed.push(projection.commands.map((command) => command.type));
      },
    });

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 2, c: 2 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 6, c: 10 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 6, c: 10 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;

    expect(activeDiagram?.data.shapes).toHaveLength(1);
    expect(committed.some((commandTypes) => commandTypes.includes("object.upsert"))).toBe(true);
  });

  it("turns dragged text creation into a borderless rectangle text box", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("TEXT"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 3, c: 4 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 9, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 9, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const createdShape = activeDiagram?.data.shapes[0];

    expect(createdShape?.shape.type).toBe("RECTANGLE");
    expect(createdShape?.style?.rectangleBorder).toBe("NONE");
    expect(createdShape?.style?.rectangleTextAlignH).toBe("CENTER");
    expect(createdShape?.style?.rectangleTextAlignV).toBe("MIDDLE");
    expect(state.diagram.mode.M).toBe("RECTANGLE_TEXT_EDIT");
  });

  it("creates normal rectangles with centered body alignment by default", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 3, c: 4 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 9, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 9, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const createdShape = activeDiagram?.data.shapes[0];

    expect(createdShape?.shape.type).toBe("RECTANGLE");
    expect(createdShape?.style?.rectangleTextAlignH).toBe("CENTER");
    expect(createdShape?.style?.rectangleTextAlignV).toBe("MIDDLE");
  });

  it("starts point-text editing on a single text click", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("TEXT"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 5, c: 7 } }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const createdShape = activeDiagram?.data.shapes[0];

    expect(createdShape?.shape.type).toBe("TEXT");
    if (createdShape?.shape.type === "TEXT") {
      expect(createdShape.shape.start).toEqual({ r: 5, c: 7 });
      expect(createdShape.shape.lines).toEqual([]);
    }
    expect(state.diagram.mode.M).toBe("TEXT_EDIT");
  });

  it("keeps point-text editing active when clicking the text being edited", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("TEXT"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 5, c: 7 } }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 5, c: 7 } }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const createdShape = activeDiagram?.data.shapes[0];

    expect(createdShape?.shape.type).toBe("TEXT");
    if (createdShape?.shape.type === "TEXT") {
      expect(createdShape.shape.start).toEqual({ r: 5, c: 7 });
      expect(createdShape.shape.lines).toEqual([]);
    }
    expect(state.diagram.mode).toEqual({
      M: "TEXT_EDIT",
      shapeId: createdShape?.id,
      startShape: {
        type: "TEXT",
        start: { r: 5, c: 7 },
        lines: [],
      },
    });
  });

  it("preserves the local text tool when remote app state replaces the active diagram data", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("TEXT"));

    const nextAppState = structuredClone(store.getState().app);
    const activeDiagram =
      nextAppState.diagrams.find((diagram) => diagram.id === nextAppState.activeDiagramId) ?? null;
    if (!activeDiagram) {
      throw new Error("active diagram missing");
    }

    activeDiagram.data.shapes.push({
      id: "remote-shape",
      shape: {
        type: "RECTANGLE",
        tl: { r: 1, c: 1 },
        br: { r: 4, c: 8 },
        labelLines: [],
      },
      style: undefined,
    });

    store.dispatch(appActions.replaceAppState(nextAppState));

    expect(store.getState().diagram.selectedTool).toBe("TEXT");
    expect(store.getState().diagram.mode.M).toBe("BEFORE_CREATING");
    expect(store.getState().diagram.shapes.some((shape) => shape.id === "remote-shape")).toBe(true);
  });

  it("cycles selection in visual reading order with Tab semantics", () => {
    const store = createAsciipStore();

    const nextAppState = structuredClone(store.getState().app);
    const activeDiagram =
      nextAppState.diagrams.find((diagram) => diagram.id === nextAppState.activeDiagramId) ?? null;
    if (!activeDiagram) {
      throw new Error("active diagram missing");
    }

    activeDiagram.data.shapes = [
      {
        id: "bottom-left",
        shape: {
          type: "RECTANGLE",
          tl: { r: 20, c: 4 },
          br: { r: 24, c: 10 },
          labelLines: [],
        },
      },
      {
        id: "top-right",
        shape: {
          type: "RECTANGLE",
          tl: { r: 2, c: 22 },
          br: { r: 6, c: 30 },
          labelLines: [],
        },
      },
      {
        id: "top-left",
        shape: {
          type: "RECTANGLE",
          tl: { r: 2, c: 4 },
          br: { r: 6, c: 12 },
          labelLines: [],
        },
      },
    ];

    store.dispatch(appActions.replaceAppState(nextAppState));
    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(
      editorInteractionActions.pointerClick({
        coords: { r: 2, c: 4 },
      }),
    );

    store.dispatch(editorInteractionActions.cycleSelection("NEXT"));
    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["top-right"],
    });

    store.dispatch(editorInteractionActions.cycleSelection("NEXT"));
    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["bottom-left"],
    });

    store.dispatch(editorInteractionActions.cycleSelection("NEXT"));
    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["top-left"],
    });
  });

  it("cycles selection backwards with Shift+Tab semantics", () => {
    const store = createAsciipStore();

    const nextAppState = structuredClone(store.getState().app);
    const activeDiagram =
      nextAppState.diagrams.find((diagram) => diagram.id === nextAppState.activeDiagramId) ?? null;
    if (!activeDiagram) {
      throw new Error("active diagram missing");
    }

    activeDiagram.data.shapes = [
      {
        id: "first",
        shape: {
          type: "RECTANGLE",
          tl: { r: 1, c: 1 },
          br: { r: 4, c: 6 },
          labelLines: [],
        },
      },
      {
        id: "second",
        shape: {
          type: "RECTANGLE",
          tl: { r: 1, c: 12 },
          br: { r: 4, c: 18 },
          labelLines: [],
        },
      },
    ];

    store.dispatch(appActions.replaceAppState(nextAppState));
    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(
      editorInteractionActions.pointerClick({
        coords: { r: 1, c: 12 },
      }),
    );

    store.dispatch(editorInteractionActions.cycleSelection("PREVIOUS"));
    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["first"],
    });

    store.dispatch(editorInteractionActions.cycleSelection("PREVIOUS"));
    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["second"],
    });
  });

  it("auto-extends the canvas when drawing beyond the top-left edge", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 2, c: 2 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: -4, c: -6 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: -4, c: -6 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const createdShape = activeDiagram?.data.shapes[0];

    expect(activeDiagram?.data.canvasSize.rows).toBeGreaterThan(75);
    expect(activeDiagram?.data.canvasSize.cols).toBeGreaterThan(250);
    expect(createdShape?.shape.type).toBe("RECTANGLE");
    if (createdShape?.shape.type === "RECTANGLE") {
      expect(createdShape.shape.tl.r).toBeGreaterThanOrEqual(0);
      expect(createdShape.shape.tl.c).toBeGreaterThanOrEqual(0);
    }
  });

  it("auto-extends the canvas when moving a selected shape beyond the top-left edge", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 8 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 12, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 12, c: 14 }));

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: -5, c: -7 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: -5, c: -7 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const movedShape = activeDiagram?.data.shapes[0];

    expect(activeDiagram?.data.canvasSize.rows).toBeGreaterThan(75);
    expect(activeDiagram?.data.canvasSize.cols).toBeGreaterThan(250);
    expect(movedShape?.shape.type).toBe("RECTANGLE");
    if (movedShape?.shape.type === "RECTANGLE") {
      expect(movedShape.shape.tl.r).toBeGreaterThanOrEqual(0);
      expect(movedShape.shape.tl.c).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not select empty rectangles from their interior area", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 2, c: 2 } }));

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 10 } }));

    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: [],
    });
  });

  it("still lets a selected empty rectangle move from its interior area", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 12, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 12, c: 18 }));

    const movedRectangle =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      )?.data.shapes[0]?.shape ?? null;

    expect(movedRectangle?.type).toBe("RECTANGLE");
    if (movedRectangle?.type === "RECTANGLE") {
      expect(movedRectangle.tl).toEqual({ r: 10, c: 14 });
      expect(movedRectangle.br).toEqual({ r: 14, c: 22 });
    }
  });

  it("selects solid rectangles from their filled interior area", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    const createdRectangleId =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      )?.data.shapes[0]?.id ?? null;

    if (!createdRectangleId) {
      throw new Error("created rectangle missing");
    }

    store.dispatch(
      editorInteractionActions.setStyle({
        shapeIds: [createdRectangleId],
        style: { rectangleFill: "SOLID" },
      }),
    );

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 10 } }));

    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: [createdRectangleId],
    });
  });

  it("keeps a line attached when moving a bound rectangle", () => {
    const store = createAsciipStore();

    const nextAppState = structuredClone(store.getState().app);
    const activeDiagram =
      nextAppState.diagrams.find((diagram) => diagram.id === nextAppState.activeDiagramId) ?? null;
    if (!activeDiagram) {
      throw new Error("active diagram missing");
    }

    activeDiagram.data.shapes = [
      {
        id: "rect-1",
        shape: {
          type: "RECTANGLE",
          tl: { r: 5, c: 5 },
          br: { r: 9, c: 11 },
          labelLines: [],
        },
      },
      {
        id: "line-1",
        shape: {
          type: "LINE",
          axis: "HORIZONTAL",
          direction: "LEFT_TO_RIGHT",
          start: { r: 7, c: 11 },
          end: { r: 7, c: 18 },
          startBinding: {
            targetShapeId: "rect-1",
            side: "RIGHT",
            position: 0.5,
          },
        },
      },
    ];

    store.dispatch(appActions.replaceAppState(nextAppState));
    store.dispatch(editorInteractionActions.setTool("SELECT"));

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 7, c: 5 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 11, c: 16 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 11, c: 16 }));

    const movedShapes =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      )?.data.shapes ?? [];
    const movedRectangle = movedShapes.find((shape) => shape.id === "rect-1")?.shape ?? null;
    const movedLine = movedShapes.find((shape) => shape.id === "line-1")?.shape ?? null;

    expect(movedRectangle?.type).toBe("RECTANGLE");
    expect(movedLine?.type).toBe("LINE");
    if (movedRectangle?.type === "RECTANGLE" && movedLine?.type === "LINE") {
      expect(movedRectangle.tl).toEqual({ r: 9, c: 16 });
      expect(movedRectangle.br).toEqual({ r: 13, c: 22 });
      expect(movedLine.start).toEqual({ r: 11, c: 22 });
      expect(movedLine.end).toEqual({ r: 11, c: 29 });
      expect(movedLine.startBinding).toEqual({
        targetShapeId: "rect-1",
        side: "RIGHT",
        position: 0.5,
      });
    }
  });

  it("keeps bound lines connected when a rectangle moves", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 24 }]);

    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const lineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const line = lineShape ? getLineShape(lineShape.shape) : null;

    expect(line?.type).toBe("MULTI_SEGMENT_LINE");
    if (line) {
      expect(line.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(line.start.c).toBe(22);
      expect(line.start.r).toBe(14);
    }
  });

  it("moves a selected bound line with the rest of the selected group", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 24 }]);

    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 6 } }));
    store.dispatch(
      editorInteractionActions.pointerClick({
        coords: { r: 8, c: 18 },
        ctrlKey: true,
      }),
    );

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const movedRectangle = activeDiagram?.data.shapes.find((shape) => shape.shape.type === "RECTANGLE");
    const movedLineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const movedLine = movedLineShape ? getLineShape(movedLineShape.shape) : null;

    expect(movedRectangle?.shape.type).toBe("RECTANGLE");
    expect(movedLine?.type).toBe("MULTI_SEGMENT_LINE");
    if (movedRectangle?.shape.type === "RECTANGLE" && movedLine) {
      expect(movedRectangle.shape.tl).toEqual({ r: 12, c: 14 });
      expect(movedRectangle.shape.br).toEqual({ r: 16, c: 22 });
      expect(movedLine.start).toEqual({ r: 14, c: 22 });
      expect(movedLine.end).toEqual({ r: 14, c: 32 });
      expect(movedLine.startBinding).toEqual({
        targetShapeId: movedRectangle.id,
        side: "RIGHT",
        position: 0.5,
        locked: false,
      });
    }
  });

  it("keeps a selected line anchored when both connected boxes move as a group", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 26 }]);

    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 4, c: 4 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 12, c: 36 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 12, c: 36 }));

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const rectangles = activeDiagram?.data.shapes.filter((shape) => shape.shape.type === "RECTANGLE") ?? [];
    const movedLineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const movedLine = movedLineShape ? getLineShape(movedLineShape.shape) : null;

    expect(rectangles).toHaveLength(2);
    expect(movedLine?.type).toBe("MULTI_SEGMENT_LINE");
    if (rectangles.length === 2 && movedLine) {
      expect(rectangles[0]?.shape.type).toBe("RECTANGLE");
      expect(rectangles[1]?.shape.type).toBe("RECTANGLE");
      if (rectangles[0]?.shape.type === "RECTANGLE" && rectangles[1]?.shape.type === "RECTANGLE") {
        expect(rectangles[0].shape.tl).toEqual({ r: 12, c: 14 });
        expect(rectangles[0].shape.br).toEqual({ r: 16, c: 22 });
        expect(rectangles[1].shape.tl).toEqual({ r: 12, c: 34 });
        expect(rectangles[1].shape.br).toEqual({ r: 16, c: 42 });
      }
      expect(movedLine.start).toEqual({ r: 14, c: 22 });
      expect(movedLine.end).toEqual({ r: 14, c: 34 });
      expect(movedLine.startBinding?.targetShapeId).toBe(rectangles[0]?.id);
      expect(movedLine.endBinding?.targetShapeId).toBe(rectangles[1]?.id);
    }
  });

  it("keeps an unselected line anchored when both connected boxes move as a group", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 26 }]);

    store.dispatch(editorInteractionActions.setTool("SELECT"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 6 } }));
    store.dispatch(
      editorInteractionActions.pointerClick({
        coords: { r: 6, c: 30 },
        ctrlKey: true,
      }),
    );

    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: expect.any(Array),
    });
    if (store.getState().diagram.mode.M !== "SELECT") {
      throw new Error("expected select mode");
    }
    expect(store.getState().diagram.mode.shapeIds).toHaveLength(2);

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 18 }));

    const state = store.getState();
    const activeDiagram =
      state.app.diagrams.find((diagram) => diagram.id === state.app.activeDiagramId) ?? null;
    const rectangles = activeDiagram?.data.shapes.filter((shape) => shape.shape.type === "RECTANGLE") ?? [];
    const movedLineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const movedLine = movedLineShape ? getLineShape(movedLineShape.shape) : null;

    expect(rectangles).toHaveLength(2);
    expect(movedLine?.type).toBe("MULTI_SEGMENT_LINE");
    if (rectangles.length === 2 && movedLine) {
      expect(rectangles[0]?.shape.type).toBe("RECTANGLE");
      expect(rectangles[1]?.shape.type).toBe("RECTANGLE");
      if (rectangles[0]?.shape.type === "RECTANGLE" && rectangles[1]?.shape.type === "RECTANGLE") {
        expect(rectangles[0].shape.tl).toEqual({ r: 12, c: 14 });
        expect(rectangles[0].shape.br).toEqual({ r: 16, c: 22 });
        expect(rectangles[1].shape.tl).toEqual({ r: 12, c: 34 });
        expect(rectangles[1].shape.br).toEqual({ r: 16, c: 42 });
      }
      expect(movedLine.start).toEqual({ r: 14, c: 22 });
      expect(movedLine.end).toEqual({ r: 14, c: 34 });
      expect(movedLine.startBinding?.targetShapeId).toBe(rectangles[0]?.id);
      expect(movedLine.endBinding?.targetShapeId).toBe(rectangles[1]?.id);
    }
  });

  it("keeps a bound line connected when the user drags the whole line", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 24 }]);

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 18 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 24 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 24 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const lineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const line = lineShape ? getLineShape(lineShape.shape) : null;

    expect(line?.type).toBe("MULTI_SEGMENT_LINE");
    if (line) {
      expect(line.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
    }
  });

  it("keeps the anchored endpoint bound when reshaping the first segment away from the box border", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    createLinePath(store, [{ r: 8, c: 14 }, { r: 8, c: 24 }]);

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 14 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 4, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 4, c: 18 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const lineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const line = lineShape ? getLineShape(lineShape.shape) : null;

    expect(line?.type).toBe("MULTI_SEGMENT_LINE");
    if (line) {
      expect(line.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(line.endBinding).toBeUndefined();
      expect(line.start).toEqual({ r: 8, c: 14 });
    }
  });

  it("connects a dragged line endpoint when it is dropped inside a box", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 24 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    createLinePath(store, [{ r: 8, c: 6 }, { r: 8, c: 18 }]);

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 18 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 8, c: 28 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 8, c: 28 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const lineShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "LINE" || shape.shape.type === "MULTI_SEGMENT_LINE"
    );
    const line = lineShape ? getLineShape(lineShape.shape) : null;

    expect(line?.type).toBe("MULTI_SEGMENT_LINE");
    if (line) {
      expect(line.endBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(line.endBinding?.side).toBeDefined();
      expect(line.end.r).toBeGreaterThanOrEqual(6);
      expect(line.end.r).toBeLessThanOrEqual(10);
      expect(line.end.c).toBeGreaterThanOrEqual(24);
      expect(line.end.c).toBeLessThanOrEqual(34);
    }
  });

  it("keeps only the connected end bound and translates a one-sided path when the target box moves", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    createLinePath(store, [
      { r: 8, c: 14 },
      { r: 8, c: 24 },
      { r: 14, c: 24 },
    ]);

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 14, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 14, c: 18 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "MULTI_SEGMENT_LINE",
    );

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(pathShape.shape.endBinding).toBeUndefined();
      expect(pathShape.shape.segments[pathShape.shape.segments.length - 1]?.end).toEqual({
        r: 20,
        c: 32,
      });
    }
  });

  it("supports double-click line label editing", () => {
    const store = createAsciipStore();

    createLinePath(store, [{ r: 12, c: 6 }, { r: 12, c: 24 }]);

    store.dispatch(editorInteractionActions.pointerDoubleClick({ r: 12, c: 15 }));
    expect(store.getState().diagram.mode.M).toBe("LINE_TEXT_EDIT");

    store.dispatch(editorInteractionActions.updateText("API"));
    store.dispatch(editorInteractionActions.completeTextInput());

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const lineShape = activeDiagram?.data.shapes[0];

    expect(lineShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (lineShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(lineShape.shape.labelLines).toEqual(["API"]);
    }
  });

  it("supports double-click rectangle border label editing", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 10, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 16, c: 28 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 16, c: 28 }));

    const rectangleId = store.getState().diagram.shapes[0]?.id;
    expect(rectangleId).toBeTruthy();
    store.dispatch(editorInteractionActions.beginRectangleLabelEdit(rectangleId!));
    store.dispatch(editorInteractionActions.updateText("Header"));
    store.dispatch(editorInteractionActions.completeTextInput());

    store.dispatch(editorInteractionActions.pointerDoubleClick({ r: 10, c: 12 }));
    expect(store.getState().diagram.mode.M).toBe("RECTANGLE_LABEL_EDIT");

    store.dispatch(editorInteractionActions.updateText("Title"));
    store.dispatch(editorInteractionActions.completeTextInput());

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const rectangleShape = activeDiagram?.data.shapes[0];

    expect(rectangleShape?.shape.type).toBe("RECTANGLE");
    if (rectangleShape?.shape.type === "RECTANGLE") {
      expect(rectangleShape.shape.label).toBe("Title");
      expect(rectangleShape.shape.labelLines ?? []).toEqual([]);
    }
  });

  it("selects rectangle body text using the current global rectangle text style", () => {
    const initialAppState = initAppState();
    const activeDiagram =
      initialAppState.diagrams.find((diagram) => diagram.id === initialAppState.activeDiagramId) ?? null;

    expect(activeDiagram).not.toBeNull();
    if (!activeDiagram) {
      return;
    }

    activeDiagram.data.globalStyle.rectangleTextAlignH = "RIGHT";
    activeDiagram.data.globalStyle.rectangleTextAlignV = "BOTTOM";
    activeDiagram.data.globalStyle.rectangleTextPadding = 2;
    activeDiagram.data.shapes = [
      {
        id: "rect-1",
        shape: {
          type: "RECTANGLE",
          tl: { r: 10, c: 10 },
          br: { r: 20, c: 30 },
          labelLines: ["Body"],
        },
      },
    ];

    const store = createAsciipStore({ initialAppState });
    store.dispatch(editorInteractionActions.setTool("SELECT"));
    const positioned = layoutRectangleLabelLines(activeDiagram.data.shapes[0]!.shape, ["Body"], {
      alignH: activeDiagram.data.globalStyle.rectangleTextAlignH,
      alignV: activeDiagram.data.globalStyle.rectangleTextAlignV,
      overflow: activeDiagram.data.globalStyle.rectangleTextOverflow,
      padding: activeDiagram.data.globalStyle.rectangleTextPadding,
    });

    expect(positioned[0]).toBeDefined();
    store.dispatch(editorInteractionActions.pointerClick({
      coords: { r: positioned[0]!.row, c: positioned[0]!.col + 1 },
    }));

    expect(store.getState().diagram.mode).toEqual({
      M: "SELECT",
      shapeIds: ["rect-1"],
    });
  });

  it("preserves spaces when editing line labels", () => {
    const store = createAsciipStore();

    createLinePath(store, [{ r: 12, c: 6 }, { r: 12, c: 24 }]);

    store.dispatch(editorInteractionActions.pointerDoubleClick({ r: 12, c: 15 }));
    store.dispatch(editorInteractionActions.updateText("API gateway"));
    store.dispatch(editorInteractionActions.completeTextInput());

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const lineShape = activeDiagram?.data.shapes[0];

    expect(lineShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (lineShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(lineShape.shape.labelLines).toEqual(["API gateway"]);
    }
  });

  it("connects both ends of an open path to two different boxes", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 14 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 8, c: 26 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 8, c: 26 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 26 } }));
    store.dispatch(editorInteractionActions.completePolyline());

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "MULTI_SEGMENT_LINE",
    );

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(pathShape.shape.endBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[1]?.id);
      expect(store.getState().diagram.mode.M).toBe("SELECT");
    }
  });

  it("simplifies a two-sided bound path when one bound box move makes it straight", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 14 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 8, c: 26 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 26 } }));

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 6, c: 30 } }));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 30 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 18, c: 30 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 18, c: 30 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "MULTI_SEGMENT_LINE",
    );
    const movedRect = activeDiagram?.data.shapes.find(
      (shapeObj) =>
        shapeObj.shape.type === "RECTANGLE" &&
        shapeObj.shape.tl.c === 26,
    );

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    expect(movedRect?.shape.type).toBe("RECTANGLE");
    if (movedRect?.shape.type === "RECTANGLE") {
      expect(movedRect.shape.tl).toEqual({ r: 16, c: 26 });
      expect(movedRect.shape.br).toEqual({ r: 20, c: 34 });
    }
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.startBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[0]?.id);
      expect(pathShape.shape.endBinding?.targetShapeId).toBe(activeDiagram?.data.shapes[1]?.id);
      expect(pathShape.shape.startBinding?.side).toBe("RIGHT");
      expect(pathShape.shape.endBinding?.side).toBe("LEFT");
      expect(pathShape.shape.segments.length).toBeGreaterThan(1);
      expect(pathShape.shape.segments[0]?.start).toEqual({ r: 10, c: 14 });
      expect(pathShape.shape.segments[pathShape.shape.segments.length - 1]?.end).toEqual({
        r: 16,
        c: 26,
      });
    }
  });

  it("preserves authored elbows when a two-sided bound path is completed", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 12, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 18, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 18, c: 34 }));

    createLinePath(store, [
      { r: 8, c: 14 },
      { r: 8, c: 20 },
      { r: 14, c: 20 },
      { r: 14, c: 26 },
    ]);

    let activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    let pathShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "MULTI_SEGMENT_LINE",
    );

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type !== "MULTI_SEGMENT_LINE") {
      return;
    }

    expect(pathShape.shape.segments.map((segment) => ({ start: segment.start, end: segment.end }))).toEqual([
      { start: { r: 8, c: 14 }, end: { r: 8, c: 20 } },
      { start: { r: 8, c: 20 }, end: { r: 14, c: 20 } },
      { start: { r: 14, c: 20 }, end: { r: 14, c: 26 } },
    ]);

  });

  it("keeps a locked connection side even when a shorter route appears after moving a box", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 6 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 14 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 14 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 6, c: 26 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 34 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 10, c: 34 }));

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 14 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 8, c: 26 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 26 } }));

    const pathId =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      )?.data.shapes.find((shape) => shape.shape.type === "MULTI_SEGMENT_LINE")?.id ?? null;

    expect(pathId).toBeTruthy();
    if (!pathId) {
      return;
    }

    store.dispatch(
      editorInteractionActions.toggleBindingLock({
        shapeId: pathId,
        endpoint: "START",
      }),
    );

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 8, c: 30 } }));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 8, c: 30 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 20, c: 18 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 20, c: 18 }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes.find((shape) => shape.id === pathId);

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.startBinding?.locked).toBe(true);
      expect(pathShape.shape.startBinding?.side).toBe("RIGHT");
      expect(pathShape.shape.segments[0]?.start).toEqual({ r: 8, c: 14 });
    }
  });

  it("snaps a two-sided bound path to the nearest facing sides instead of the clicked corners", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 10, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 20, c: 30 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 20, c: 30 }));

    store.dispatch(editorInteractionActions.setTool("RECTANGLE"));
    store.dispatch(editorInteractionActions.pointerDown({ coords: { r: 18, c: 40 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 22, c: 50 }));
    store.dispatch(editorInteractionActions.pointerUp({ r: 22, c: 50 }));

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 20, c: 30 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 20, c: 40 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 20, c: 40 } }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes.find(
      (shape) => shape.shape.type === "MULTI_SEGMENT_LINE",
    );

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.startBinding?.side).toBe("RIGHT");
      expect(pathShape.shape.endBinding?.side).toBe("LEFT");
      expect(pathShape.shape.segments[0]?.start.c).toBe(30);
      expect(pathShape.shape.segments[pathShape.shape.segments.length - 1]?.end.c).toBe(40);
    }
  });

  it("selects and deletes a path point", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 20 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 20 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 16, c: 20 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 16, c: 20 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 16, c: 28 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 16, c: 28 } }));
    store.dispatch(editorInteractionActions.completePolyline());

    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 20 } }));
    expect(store.getState().diagram.selectedPathPoint).toEqual({
      shapeId: store.getState().diagram.mode.M === "SELECT" ? store.getState().diagram.mode.shapeIds[0] : "",
      pointIndex: 0,
    });

    store.dispatch(editorInteractionActions.deleteSelection());

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes[0];

    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.segments).toHaveLength(2);
    }
    expect(store.getState().diagram.selectedPathPoint).toBeNull();
  });

  it("closes a multi-segment path when the last segment reconnects to the start", () => {
    const store = createAsciipStore();

    store.dispatch(editorInteractionActions.setTool("MULTI_SEGMENT_LINE"));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 20 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 20 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 16, c: 20 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 16, c: 20 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 16, c: 10 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 16, c: 10 } }));
    store.dispatch(editorInteractionActions.pointerHover({ r: 10, c: 10 }));
    store.dispatch(editorInteractionActions.pointerClick({ coords: { r: 10, c: 10 } }));

    const activeDiagram =
      store.getState().app.diagrams.find(
        (diagram) => diagram.id === store.getState().app.activeDiagramId,
      ) ?? null;
    const pathShape = activeDiagram?.data.shapes[0];

    expect(store.getState().diagram.mode.M).toBe("SELECT");
    expect(pathShape?.shape.type).toBe("MULTI_SEGMENT_LINE");
    if (pathShape?.shape.type === "MULTI_SEGMENT_LINE") {
      expect(pathShape.shape.closed).toBe(true);
      expect(pathShape.shape.segments).toHaveLength(4);
      expect(pathShape.shape.segments[0]?.start).toEqual(
        pathShape.shape.segments[pathShape.shape.segments.length - 1]?.end,
      );
    }
  });
});
