import {
  addListener,
  createListenerMiddleware,
  isAnyOf,
} from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "./store";
import { AppState, appActions, appSelectors } from "./appSlice";
import _ from "lodash";
import { type DiagramData, diagramActions, diagramReducer } from "./diagramSlice";
import { editorInteractionActions } from "./editorInteractionActions";
import { projectAppStateTransitionThroughCommands, projectDiagramStateTransitionThroughCommands, type EditorStateCommandProjection } from "@/lib/canvascii/command-projection";
import { canvasDocumentToDiagramData } from "@/lib/canvascii/document-bridge";

export type AsciipCommittedState = {
  state: AppState
  projection: EditorStateCommandProjection
}

type TaggedAction<T = unknown> = {
  type: string
  payload?: T
  meta?: {
    origin?: "editorInteraction"
  }
}

function toDiagramData(state: RootState["diagram"]) {
  const { canvasSize, shapes, groups, portalViews, styleMode, globalStyle } = state
  return {
    canvasSize,
    shapes,
    groups,
    portalViews,
    styleMode,
    globalStyle,
  }
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function mergeDiagramDataIntoAppState(appState: AppState, diagramData: ReturnType<typeof toDiagramData>): AppState {
  return {
    ...appState,
    diagrams: appState.diagrams.map((diagram) =>
      diagram.id === appState.activeDiagramId
        ? {
            ...diagram,
            data: diagramData,
          }
        : diagram,
    ),
  }
}

export function createAsciipListenerMiddleware(
  options?: {
    documentId?: string
    onPersistState?: (state: AppState) => void
    onCommittedState?: (payload: AsciipCommittedState) => void
  }
) {
  const listenerMiddleware = createListenerMiddleware();
  const startAppListening = listenerMiddleware.startListening.withTypes<
    RootState,
    AppDispatch
  >();

  function emitCommittedDiagramProjection(listenerApi: Parameters<typeof startAppListening>[0]["effect"] extends ((...args: infer T) => unknown) ? T[1] : never) {
    const currentAppState = listenerApi.getState().app
    const nextDiagramData = toDiagramData(listenerApi.getState().diagram)
    const previousDiagramData = toDiagramData(listenerApi.getOriginalState().diagram)

    if (_.isEqual(nextDiagramData, previousDiagramData)) {
      return
    }

    const nextAppState = mergeDiagramDataIntoAppState(currentAppState, nextDiagramData)
    const projection = projectDiagramStateTransitionThroughCommands({
      appState: currentAppState,
      previousDiagramData,
      nextDiagramData,
      documentId: options?.documentId,
      updatedAt: new Date().toISOString(),
    })

    options?.onCommittedState?.({
      state: nextAppState,
      projection,
    })
  }

  function dispatchTaggedDiagramAction(
    listenerApi: Parameters<typeof startAppListening>[0]["effect"] extends ((...args: infer T) => unknown) ? T[1] : never,
    action: TaggedAction,
  ) {
    listenerApi.dispatch({
      ...action,
      meta: {
        ...(action.meta ?? {}),
        origin: "editorInteraction",
      },
    } as never)
  }

  function applyCommandFirstInteraction<Payload>(
    actionCreator: { match: (action: unknown) => action is { type: string; payload: Payload } },
    createDiagramAction: (payload: Payload) => unknown,
  ) {
    startAppListening({
      predicate: (action): action is { type: string; payload: Payload } => actionCreator.match(action),
      effect: (action, listenerApi) => {
        const currentState = listenerApi.getState()
        const diagramAction = createDiagramAction(action.payload) as TaggedAction
        const previewDiagramState = diagramReducer(
          currentState.diagram,
          diagramAction as never,
        )
        const previousDiagramData = toDiagramData(currentState.diagram)
        const nextDiagramData = toDiagramData(previewDiagramState)

        if (_.isEqual(previousDiagramData, nextDiagramData)) {
          const activeDiagram =
            currentState.app.diagrams.find(
              (diagram) => diagram.id === currentState.app.activeDiagramId,
            ) ?? null
          const appDiagramData = activeDiagram?.data ?? null

          if (!appDiagramData || _.isEqual(appDiagramData, previousDiagramData)) {
            dispatchTaggedDiagramAction(listenerApi, diagramAction)
            return
          }

          const projection = projectDiagramStateTransitionThroughCommands({
            appState: currentState.app,
            previousDiagramData: appDiagramData,
            nextDiagramData: previousDiagramData,
            documentId: options?.documentId,
            updatedAt: new Date().toISOString(),
          })

          const canonicalDiagramData =
            canvasDocumentToDiagramData(projection.document, currentState.app.activeDiagramId) ??
            cloneSerializable(previousDiagramData)

          listenerApi.dispatch(
            diagramActions.applyCommittedDiagramState({
              nextState: previewDiagramState,
              canonicalDiagramData,
            }),
          )
          listenerApi.dispatch(
            appActions.updateDiagramData(cloneSerializable(canonicalDiagramData)),
          )

          options?.onCommittedState?.({
            state: mergeDiagramDataIntoAppState(currentState.app, canonicalDiagramData),
            projection,
          })
          return
        }

        const projection = projectDiagramStateTransitionThroughCommands({
          appState: currentState.app,
          previousDiagramData,
          nextDiagramData,
          documentId: options?.documentId,
          updatedAt: new Date().toISOString(),
        })

        const canonicalDiagramData =
          canvasDocumentToDiagramData(projection.document, currentState.app.activeDiagramId) ??
          cloneSerializable(nextDiagramData)

        listenerApi.dispatch(
          diagramActions.applyCommittedDiagramState({
            nextState: previewDiagramState,
            canonicalDiagramData,
          }),
        )
        listenerApi.dispatch(
          appActions.updateDiagramData(cloneSerializable(canonicalDiagramData)),
        )

        options?.onCommittedState?.({
          state: mergeDiagramDataIntoAppState(currentState.app, canonicalDiagramData),
          projection,
        })
      },
    })
  }

  function forwardEditorInteraction<Payload>(
    actionCreator: { match: (action: unknown) => action is { type: string; payload: Payload } },
    createDiagramAction: (payload: Payload) => unknown,
    options?: {
      commitLike?: boolean
    },
  ) {
    startAppListening({
      predicate: (action): action is { type: string; payload: Payload } => actionCreator.match(action),
      effect: (action, listenerApi) => {
        dispatchTaggedDiagramAction(listenerApi, createDiagramAction(action.payload) as TaggedAction)
        if (options?.commitLike) {
          emitCommittedDiagramProjection(listenerApi)
        }
      },
    });
  }

  startAppListening({
    matcher: editorInteractionActions.pointerLeave.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.onCanvasMouseLeave());
    },
  });

  startAppListening({
    matcher: editorInteractionActions.consumePendingCanvasScroll.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.consumePendingCanvasScroll());
    },
  });

  startAppListening({
    matcher: editorInteractionActions.enableMoveDuplication.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.onEnableMoveDuplication());
    },
  });

  applyCommandFirstInteraction(editorInteractionActions.completeTextInput, () => diagramActions.onCtrlEnterPress());
  applyCommandFirstInteraction(editorInteractionActions.alignSelectedText, diagramActions.alignSelectedText);
  applyCommandFirstInteraction(editorInteractionActions.encloseSelectedText, () => diagramActions.encloseSelectedText());
  applyCommandFirstInteraction(editorInteractionActions.completePolyline, () => diagramActions.onEnterPress());
  applyCommandFirstInteraction(
    editorInteractionActions.toggleBindingLock,
    (payload) => diagramActions.toggleLineBindingLock(payload),
  );
  applyCommandFirstInteraction(editorInteractionActions.exitInteractionMode, () => diagramActions.onExitEditModePress());
  applyCommandFirstInteraction(editorInteractionActions.deleteSelection, () => diagramActions.onDeletePress());

  startAppListening({
    matcher: editorInteractionActions.cycleSelection.match,
    effect: (action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.cycleSelection(action.payload));
    },
  });

  startAppListening({
    matcher: editorInteractionActions.selectAll.match,
    effect: (_action, listenerApi) => {
      listenerApi.dispatch(diagramActions.onCtrlAPress());
    },
  });

  startAppListening({
    matcher: editorInteractionActions.copySelection.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.onCopyPress());
    },
  });

  applyCommandFirstInteraction(editorInteractionActions.pasteClipboard, () => diagramActions.onPastePress());
  applyCommandFirstInteraction(editorInteractionActions.moveSelectionToFront, () => diagramActions.onMoveToFrontButtonClick());
  applyCommandFirstInteraction(editorInteractionActions.moveSelectionToBack, () => diagramActions.onMoveToBackButtonClick());
  applyCommandFirstInteraction(editorInteractionActions.groupSelection, () => diagramActions.groupSelection());
  applyCommandFirstInteraction(editorInteractionActions.ungroupSelection, () => diagramActions.ungroupSelection());
  applyCommandFirstInteraction(editorInteractionActions.addPortalView, diagramActions.addPortalView);
  applyCommandFirstInteraction(editorInteractionActions.updatePortalView, diagramActions.updatePortalView);
  applyCommandFirstInteraction(editorInteractionActions.deletePortalView, diagramActions.deletePortalView);
  applyCommandFirstInteraction(editorInteractionActions.expandCanvas, () => diagramActions.expandCanvas());
  applyCommandFirstInteraction(editorInteractionActions.shrinkCanvasToFit, () => diagramActions.shrinkCanvasToFit());

  startAppListening({
    matcher: editorInteractionActions.openExport.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.openExport());
    },
  });

  startAppListening({
    matcher: editorInteractionActions.closeExport.match,
    effect: (_action, listenerApi) => {
      dispatchTaggedDiagramAction(listenerApi, diagramActions.closeExport());
    },
  });

  forwardEditorInteraction(editorInteractionActions.pointerHover, diagramActions.onCellHover);
  forwardEditorInteraction(editorInteractionActions.pointerDown, diagramActions.onCellMouseDown);
  applyCommandFirstInteraction(editorInteractionActions.pointerUp, diagramActions.onCellMouseUp);
  applyCommandFirstInteraction(editorInteractionActions.pointerClick, diagramActions.onCellClick);
  applyCommandFirstInteraction(editorInteractionActions.pointerDoubleClick, diagramActions.onCellDoubleClick);
  forwardEditorInteraction(editorInteractionActions.setTool, diagramActions.setTool);
  forwardEditorInteraction(editorInteractionActions.updateText, diagramActions.updateText);
  applyCommandFirstInteraction(
    editorInteractionActions.applyCommittedTextTransform,
    diagramActions.applyCommittedTextTransform,
  );
  forwardEditorInteraction(editorInteractionActions.setTextCursor, diagramActions.setTextCursor);
  forwardEditorInteraction(
    editorInteractionActions.beginRectangleLabelEdit,
    diagramActions.beginRectangleLabelEdit,
  );
  applyCommandFirstInteraction(editorInteractionActions.moveInHistory, diagramActions.moveInHistory);
  applyCommandFirstInteraction(editorInteractionActions.setStyleMode, diagramActions.setStyleMode);
  applyCommandFirstInteraction(editorInteractionActions.setStyle, diagramActions.setStyle);

  /**
   * appSlice -> diagramSlice
   * If we selected a new active diagram => load diagram into diagramSlice
   */
  startAppListening({
    predicate: (action, currentState, originalState) => {
      return (
        currentState.app.activeDiagramId !== originalState.app.activeDiagramId
      );
    },
    effect: (action, listenerApi) => {
      const activeDiagram = appSelectors.activeDiagram(listenerApi.getState());
      listenerApi.dispatch(diagramActions.loadDiagram(activeDiagram.data));
    },
  });

  startAppListening({
    matcher: isAnyOf(appActions.replaceAppState),
    effect: (_action, listenerApi) => {
      const activeDiagram = appSelectors.activeDiagram(listenerApi.getState());
      const originalState = listenerApi.getOriginalState();
      const activeDiagramChanged =
        originalState.app.activeDiagramId !== listenerApi.getState().app.activeDiagramId;

      if (activeDiagramChanged) {
        listenerApi.dispatch(diagramActions.loadDiagram(activeDiagram.data));
        return;
      }

      listenerApi.dispatch(
        diagramActions.applyCommittedDiagramState({
          nextState: listenerApi.getState().diagram,
          canonicalDiagramData: cloneSerializable(activeDiagram.data),
        }),
      );
    },
  });

  /**
   * diagramSlice -> appSlice
   * Persist diagram snapshot on commit-like events (history/style/canvas),
   * not every transient drag frame.
   */
  const debouncedUpdateDiagramData = _.debounce((_action, listenerApi) => {
    const { canvasSize, shapes, groups, portalViews, styleMode, globalStyle } =
      listenerApi.getState().diagram;

    listenerApi.dispatch(
      appActions.updateDiagramData({
        canvasSize,
        shapes,
        groups,
        portalViews,
        styleMode,
        globalStyle,
      })
    );
  }, 500);

  startAppListening({
    predicate: (_action, currentState, originalState) => {
      if (diagramActions.applyCommittedDiagramState.match(_action)) {
        return false
      }
      if (diagramActions.loadDiagram.match(_action)) {
        return false
      }
      return (
        currentState.diagram.historyIdx !== originalState.diagram.historyIdx ||
        currentState.diagram.styleMode !== originalState.diagram.styleMode ||
        currentState.diagram.globalStyle !== originalState.diagram.globalStyle ||
        currentState.diagram.canvasSize !== originalState.diagram.canvasSize
      );
    },
    effect: debouncedUpdateDiagramData,
  });

  /**
   * appSlice -> persisted state callback
   * If data is modified in appSlice => publish it to caller persistence.
   * `updateDiagramData` is already debounced above, so adding another debounce
   * here leaves parent state stale long enough for autosave/collab bootstrap
   * to replay an older empty document back into the editor.
   */
  startAppListening({
    matcher: isAnyOf(
      appActions.createDiagram,
      appActions.setActiveDiagram,
      appActions.updateDiagramMetadata,
      appActions.renameDiagram,
      appActions.deleteDiagram
    ),
    effect: (action, listenerApi) => {
      const nextAppState = listenerApi.getState().app
      const previousAppState = listenerApi.getOriginalState().app
      const projection = projectAppStateTransitionThroughCommands({
        action,
        previousEditorState: previousAppState,
        nextEditorState: nextAppState,
        documentId: options?.documentId,
        updatedAt: new Date().toISOString(),
      })

      options?.onPersistState?.(nextAppState);
      options?.onCommittedState?.({
        state: nextAppState,
        projection,
      })
    },
  });

  startAppListening({
    matcher: isAnyOf(
      diagramActions.expandCanvas,
      diagramActions.shrinkCanvasToFit,
      diagramActions.onCellDoubleClick,
      diagramActions.onCellClick,
      diagramActions.onCellMouseUp,
      diagramActions.onCtrlEnterPress,
      diagramActions.onEnterPress,
      diagramActions.onExitEditModePress,
      diagramActions.onDeletePress,
      diagramActions.onPastePress,
      diagramActions.moveInHistory,
      diagramActions.setStyleMode,
      diagramActions.setStyle,
      diagramActions.onMoveToFrontButtonClick,
      diagramActions.onMoveToBackButtonClick
    ),
    effect: (action, listenerApi) => {
      if ((action as TaggedAction).meta?.origin === "editorInteraction") {
        return
      }
      emitCommittedDiagramProjection(listenerApi)
    },
  });

  startAppListening({
    matcher: isAnyOf(appActions.updateDiagramData),
    effect: (_action, listenerApi) => {
      options?.onPersistState?.(listenerApi.getState().app)
    },
  });

  return listenerMiddleware;
}

export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
