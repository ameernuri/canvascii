import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { CELL_HEIGHT, CELL_WIDTH, FONT, FONT_FAMILY, FONT_SIZE } from "./draw";
import {
  applyIndentationOnTab,
  applyListContinuationOnEnter,
  getStringFromShape,
} from "../../models/text";
import {
  ChangeEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { selectors } from "../../store/selectors";
import { editorTheme } from "../../theme";
import { defaultStyle } from "../../models/style";
import {
  getRectangleBorderLabelWidth,
  getRectangleEditorLayout,
  getRectangleLabelArea,
} from "../../models/rectangleText";
import { getLineLabelBox, isLineLikeShape } from "../../models/lineFeatures";

function getCursorCell(value: string, selectionStart: number): { row: number; col: number } {
  const safeIndex = Math.max(0, Math.min(selectionStart, value.length));
  const prefix = value.slice(0, safeIndex);
  const lines = prefix.split("\n");
  return {
    row: Math.max(0, lines.length - 1),
    col: Array.from(lines[lines.length - 1] ?? "").length,
  };
}

export function TextShapeInput() {
  const interactions = useEditorInteractions();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const lastEditSessionKeyRef = useRef<string | null>(null);
  const mode = useAppSelector((state) => state.diagram.mode);
  const shapes = useAppSelector((state) => state.diagram.shapes);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);

  const currentEditedText = useAppSelector((state) =>
    selectors.currentEditedText(state.diagram)
  )!;
  const textValue = getStringFromShape(currentEditedText);

  const rectangleEditConfig = useMemo(() => {
    const editMode = mode;
    if (
      editMode.M !== "RECTANGLE_TEXT_EDIT" &&
      editMode.M !== "RECTANGLE_LABEL_EDIT"
    ) {
      return null;
    }
    const shapeObj = shapes.find(
      (shape) => shape.id === editMode.shapeId
    );
    if (!shapeObj || shapeObj.shape.type !== "RECTANGLE") {
      return null;
    }
    const mergedStyle = {
      ...defaultStyle(),
      ...globalStyle,
      ...(shapeObj.style ?? {}),
    };
    return {
      mode: editMode.M,
      rectangle: shapeObj.shape,
      area: getRectangleLabelArea(
        shapeObj.shape,
        mergedStyle.rectangleTextPadding
      ),
      alignH: mergedStyle.rectangleTextAlignH,
      alignV: mergedStyle.rectangleTextAlignV,
      padding: mergedStyle.rectangleTextPadding,
      isSolidFill: mergedStyle.rectangleFill === "SOLID",
      labelWidth: getRectangleBorderLabelWidth(shapeObj.shape),
      layout: getRectangleEditorLayout(
        shapeObj.shape.labelLines ?? [],
        shapeObj.shape,
        mergedStyle.rectangleTextAlignV,
        mergedStyle.rectangleTextPadding
      ),
    };
  }, [globalStyle, mode, shapes]);

  const lineEditConfig = useMemo(() => {
    const editMode = mode;
    if (editMode.M !== "LINE_TEXT_EDIT") {
      return null;
    }
    const shapeObj = shapes.find((shape) => shape.id === editMode.shapeId);
    if (!shapeObj || !isLineLikeShape(shapeObj.shape)) {
      return null;
    }
    const mergedStyle = {
      ...defaultStyle(),
      ...globalStyle,
      ...(shapeObj.style ?? {}),
    };
    return {
      box: getLineLabelBox(shapeObj.shape, {
        lineTextAlign: mergedStyle.lineTextAlign,
        lineTextPadding: mergedStyle.lineTextPadding,
      }),
      textAlign:
        (getLineLabelBox(shapeObj.shape, {
          lineTextAlign: mergedStyle.lineTextAlign,
          lineTextPadding: mergedStyle.lineTextPadding,
        })?.textAlign ?? "left") as "left" | "center" | "right",
    };
  }, [globalStyle, mode, shapes]);

  const toAbsoluteCursor = (value: string, selectionStart: number) => {
    const cursor = getCursorCell(value, selectionStart);
    return {
      r: currentEditedText.start.r + cursor.row,
      c: currentEditedText.start.c + cursor.col,
    };
  };

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    interactions.updateText(event.target.value);
    if (rectangleEditConfig || lineEditConfig) {
      interactions.setTextCursor(null);
      return;
    }
    const cursor = toAbsoluteCursor(
      event.target.value,
      event.target.selectionStart ?? event.target.value.length
    );
    interactions.setTextCursor(cursor);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;

    if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const result = applyIndentationOnTab(input.value, selectionStart, selectionEnd, {
        outdent: event.shiftKey,
      });
      if (!result.handled) {
        return;
      }

      event.preventDefault();
      pendingSelectionRef.current = {
        start: result.nextSelectionStart,
        end: result.nextSelectionEnd,
      };
      interactions.applyCommittedTextTransform(result.value);

      if (rectangleEditConfig || lineEditConfig) {
        interactions.setTextCursor(null);
        return;
      }

      const cursor = toAbsoluteCursor(result.value, result.nextSelectionEnd);
      interactions.setTextCursor(cursor);
      return;
    }

    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    if (rectangleEditConfig?.mode === "RECTANGLE_LABEL_EDIT") {
      event.preventDefault();
      interactions.completeTextInput();
      return;
    }
    const result = applyListContinuationOnEnter(
      input.value,
      selectionStart,
      selectionEnd
    );
    if (!result.handled) {
      return;
    }

    event.preventDefault();
    pendingSelectionRef.current = {
      start: result.nextSelectionStart,
      end: result.nextSelectionStart,
    };
    interactions.updateText(result.value);

    if (rectangleEditConfig || lineEditConfig) {
      interactions.setTextCursor(null);
      return;
    }

    const cursor = toAbsoluteCursor(result.value, result.nextSelectionStart);
    interactions.setTextCursor(cursor);
  };

  const syncCursorFromInput = () => {
    const input = inputRef.current;
    if (!input) return;
    if (rectangleEditConfig || lineEditConfig) {
      interactions.setTextCursor(null);
      return;
    }
    const cursor = toAbsoluteCursor(input.value, input.selectionStart ?? 0);
    interactions.setTextCursor(cursor);
  };

  const inputBoxSize = useMemo(() => {
    if (rectangleEditConfig) {
      if (rectangleEditConfig.mode === "RECTANGLE_LABEL_EDIT") {
        return {
          width: Math.max(1, rectangleEditConfig.labelWidth) * CELL_WIDTH,
          height: CELL_HEIGHT + 2,
          rows: 1,
          topOffsetRows: 0,
          paddingTop: 0,
        };
      }
      const widthCells = Math.max(1, rectangleEditConfig.layout.area.width);
      const contentRows = Math.max(1, rectangleEditConfig.layout.contentRows);
      const topOffsetRows = Math.max(0, rectangleEditConfig.layout.topOffsetRows);
      const heightRows = Math.max(
        rectangleEditConfig.layout.area.height,
        topOffsetRows + contentRows
      );
      return {
        width: widthCells * CELL_WIDTH,
        height: heightRows * CELL_HEIGHT,
        rows: 1,
        topOffsetRows: 0,
        paddingTop: topOffsetRows * CELL_HEIGHT,
      };
    }
    if (lineEditConfig?.box) {
      return {
        width: Math.max(8, lineEditConfig.box.widthCells) * CELL_WIDTH + 8,
        height: CELL_HEIGHT + 6,
        rows: 1,
        topOffsetRows: 0,
        paddingTop: 0,
      };
    }
    const maxLineLength = currentEditedText.lines.reduce(
      (acc, line) => Math.max(acc, line.length),
      0
    );
    return {
      width: Math.max(8, maxLineLength + 1) * CELL_WIDTH + 8,
      height: Math.max(1, currentEditedText.lines.length || 1) * CELL_HEIGHT + 6,
      rows: Math.max(1, currentEditedText.lines.length || 1),
      topOffsetRows: 0,
      paddingTop: 0,
    };
  }, [currentEditedText.lines, lineEditConfig, rectangleEditConfig]);

  const editSessionKey = useMemo(() => {
    const editMode = mode;
    if (
      editMode.M !== "TEXT_EDIT" &&
      editMode.M !== "LINE_TEXT_EDIT" &&
      editMode.M !== "RECTANGLE_TEXT_EDIT" &&
      editMode.M !== "RECTANGLE_LABEL_EDIT"
    ) {
      return null;
    }

    return `${editMode.M}:${editMode.shapeId}:${currentEditedText.start.r}:${currentEditedText.start.c}`;
  }, [currentEditedText.start.c, currentEditedText.start.r, mode]);

  // At mount, put the cursor to the end of the input
  useEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    if (inputRef.current && pendingSelection != null) {
      inputRef.current.setSelectionRange(pendingSelection.start, pendingSelection.end);
      pendingSelectionRef.current = null;
    }
  }, [textValue]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || !editSessionKey) {
      return;
    }

    if (lastEditSessionKeyRef.current === editSessionKey) {
      return;
    }

    lastEditSessionKeyRef.current = editSessionKey;
    const length = input.value.length;
    input.setSelectionRange(length, length);
    if (rectangleEditConfig || lineEditConfig) {
      interactions.setTextCursor(null);
      return;
    }
    interactions.setTextCursor(toAbsoluteCursor(input.value, length));
  }, [editSessionKey, interactions, lineEditConfig, rectangleEditConfig]);

  useEffect(() => {
    return () => {
      interactions.setTextCursor(null);
    };
  }, [interactions]);

  return (
    <div
      style={{
        position: "absolute",
        left: `${currentEditedText.start.c * CELL_WIDTH}px`,
        top: `${(currentEditedText.start.r + inputBoxSize.topOffsetRows) * CELL_HEIGHT}px`,
        zIndex: 3,
      }}
    >
      <textarea
        id="text-shape-input"
        ref={inputRef}
        autoFocus
        spellCheck={false}
        rows={inputBoxSize.rows}
        wrap={rectangleEditConfig?.mode === "RECTANGLE_TEXT_EDIT" ? "soft" : "off"}
        value={textValue}
        onKeyDown={handleKeyDown}
        onChange={handleTextChange}
        onSelect={syncCursorFromInput}
        onKeyUp={syncCursorFromInput}
        onClick={syncCursorFromInput}
        style={{
          width: `${inputBoxSize.width}px`,
          height: `${inputBoxSize.height}px`,
          margin: 0,
          padding: `${inputBoxSize.paddingTop}px 0 0 0`,
          border: "none",
          borderRadius: 2,
          resize: "none",
          overflow: "hidden",
          boxSizing: rectangleEditConfig || lineEditConfig ? "border-box" : "content-box",
          font: FONT,
          fontFamily: FONT_FAMILY,
          fontSize: `${FONT_SIZE}px`,
          lineHeight: `${CELL_HEIGHT}px`,
          background: "transparent",
          color: rectangleEditConfig
            ? rectangleEditConfig.isSolidFill
              ? editorTheme.canvas.background
              : editorTheme.canvas.selectedShape
            : lineEditConfig
            ? editorTheme.canvas.selectedShape
            : "transparent",
          caretColor: rectangleEditConfig || lineEditConfig ? "#ffffff" : "transparent",
          outline: "none",
          whiteSpace:
            rectangleEditConfig?.mode === "RECTANGLE_TEXT_EDIT"
              ? "break-spaces"
              : "pre",
          overflowWrap:
            rectangleEditConfig?.mode === "RECTANGLE_TEXT_EDIT"
              ? "break-word"
              : "normal",
          wordBreak:
            rectangleEditConfig?.mode === "RECTANGLE_TEXT_EDIT"
              ? "break-word"
              : "normal",
          textAlign:
            rectangleEditConfig?.alignH === "RIGHT"
              ? "right"
              : rectangleEditConfig?.alignH === "CENTER"
              ? "center"
              : lineEditConfig?.textAlign ?? "left",
        }}
      />
    </div>
  );
}
