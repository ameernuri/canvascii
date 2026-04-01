import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { DiagramData, initDiagramData } from "./diagramSlice";
import { v4 as uuidv4 } from "uuid";
import { createUniqueCanvasName } from "@canvascii/agent-client/canvas-names";

const INITIAL_CANVAS_NAME = "amber-aurora";

/**
 * A "diagram" is still the internal storage name for one editable canvas page.
 * The user-facing model is now nested canvases/pages inside a single file.
 */
export type CanvasNodeKind = "page" | "component";
export type ComponentAttribute = {
  key: string;
  defaultValue: string;
};

export type DiagramMetadata = {
  id: string;
  name: string;
  parentCanvasId: string | null;
  kind: CanvasNodeKind;
  sourceCanvasId: string | null;
  componentAttributes: ComponentAttribute[];
};

export type Diagram = DiagramMetadata & {
  data: DiagramData;
};

export type AppState = {
  diagrams: Diagram[];
  activeDiagramId: string;

  // UI state
  createDiagramInProgress: boolean;
  deleteDiagramInProgress: string | null;
  renameDiagramInProgress: string | null;
};

export const initAppState = (): AppState => {
  const id = uuidv4();

  const firstDiagram: Diagram = {
    id,
    name: INITIAL_CANVAS_NAME,
    parentCanvasId: null,
    kind: "page",
    sourceCanvasId: null,
    componentAttributes: [],
    data: initDiagramData(),
  };

  return {
    diagrams: [firstDiagram],
    activeDiagramId: id,

    deleteDiagramInProgress: null,
    renameDiagramInProgress: null,
    createDiagramInProgress: false,
  };
};

export const appSlice = createSlice({
  name: "app",
  initialState: initAppState(),
  reducers: {
    replaceAppState: (_state, action: PayloadAction<AppState>) => {
      return action.payload;
    },
    setActiveDiagram: (state, action: PayloadAction<string>) => {
      state.activeDiagramId = action.payload;
    },
    createDiagram: (
      state,
      action: PayloadAction<
        | string
        | {
            name?: string;
            parentCanvasId?: string | null;
            kind?: CanvasNodeKind;
            sourceCanvasId?: string | null;
            componentAttributes?: ComponentAttribute[];
          }
      >
    ) => {
      if (typeof action.payload === "string") {
        createDiagram(state, { name: action.payload });
      } else {
        createDiagram(state, action.payload);
      }
      state.createDiagramInProgress = false;
    },
    deleteDiagram: (state, action: PayloadAction<string>) => {
      const deletedId = action.payload;
      const deletedDiagramIdx = state.diagrams.findIndex(
        (d) => d.id === deletedId
      );

      if (deletedDiagramIdx > -1) {
        // Delete diagram
        state.diagrams.splice(deletedDiagramIdx, 1);

        // If we're deleting the last diagram, then create a new default diagram
        if (state.diagrams.length === 0) {
          createDiagram(state);
        } else {
          // If the deleted diagram is the active one, then set the active diagram to the first diagram on the list
          if (deletedId === state.activeDiagramId) {
            state.activeDiagramId = state.diagrams[0].id;
          }
        }
      }
      state.deleteDiagramInProgress = null;
    },
    renameDiagram: (
      state,
      action: PayloadAction<{ id: string; newName: string }>
    ) => {
      const diagram = state.diagrams.find((d) => d.id === action.payload.id);
      if (diagram) {
        diagram.name = action.payload.newName;
      }
      state.renameDiagramInProgress = null;
    },
    updateDiagramMetadata: (
      state,
      action: PayloadAction<{
        id: string;
        changes: Partial<Pick<DiagramMetadata, "name" | "parentCanvasId" | "kind" | "sourceCanvasId" | "componentAttributes">>;
      }>
    ) => {
      const diagram = state.diagrams.find((d) => d.id === action.payload.id);
      if (!diagram) {
        return;
      }
      Object.assign(diagram, action.payload.changes);
    },
    startCreateDiagram: (state) => {
      state.createDiagramInProgress = true;
    },
    cancelCreateDiagram: (state) => {
      state.createDiagramInProgress = false;
    },
    startDeleteDiagram: (state, action: PayloadAction<string>) => {
      state.deleteDiagramInProgress = action.payload;
    },
    cancelDeleteDiagram: (state) => {
      state.deleteDiagramInProgress = null;
    },
    startRenameDiagram: (state, action: PayloadAction<string>) => {
      state.renameDiagramInProgress = action.payload;
    },
    cancelRenameDiagram: (state) => {
      state.renameDiagramInProgress = null;
    },

    updateDiagramData: (state, action: PayloadAction<DiagramData>) => {
      const idx = state.diagrams.findIndex(
        (d) => d.id === state.activeDiagramId
      );
      state.diagrams[idx].data = action.payload;
    },
  },
  selectors: {
    activeDiagram: (state): Diagram => {
      return state.diagrams.find((d) => d.id === state.activeDiagramId)!;
    },
  },
});

//#region Helper state function that mutate directly the state
function createDiagram(
  state: AppState,
  input?: {
    name?: string;
    parentCanvasId?: string | null;
    kind?: CanvasNodeKind;
    sourceCanvasId?: string | null;
    componentAttributes?: ComponentAttribute[];
  }
) {
  const id = uuidv4();
  const newDiagram: Diagram = {
    id,
    name: input?.name ?? createUniqueCanvasName(state.diagrams.map((diagram) => diagram.name)),
    parentCanvasId: input?.parentCanvasId ?? null,
    kind: input?.kind ?? "page",
    sourceCanvasId: input?.sourceCanvasId ?? null,
    componentAttributes: input?.componentAttributes ?? [],
    data: initDiagramData(),
  };
  state.diagrams = [...state.diagrams, newDiagram];
  state.activeDiagramId = id;
}

export const appReducer = appSlice.reducer;
export const appActions = appSlice.actions;
export const appSelectors = appSlice.selectors;
