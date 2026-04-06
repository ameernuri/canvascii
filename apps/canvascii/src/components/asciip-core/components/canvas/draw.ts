import _ from "lodash";
import { Coords, Shape } from "../../models/shapes";
import {
  CellValueMap,
  Char,
  getAbstractShapeRepresentation,
} from "../../models/representation";
import { ResizePoint, getResizePoints } from "../../models/transformation";
import {
  Style,
  StyleMode,
  getCharRepr,
  resolveRectangleBorder,
} from "../../models/style";
import { ShapeObject } from "../../store/diagramSlice";
import {
  BoundingBox,
  getBoundingBoxResizePoints,
} from "../../models/shapeInCanvas";
import {
  getRectangleBorderLabelCellValueMap,
  getRectangleLabelCellValueMap,
  getRectangleBorderLabelStart,
  getRectangleBorderLabelWidth,
} from "../../models/rectangleText";
import { getLineLabelTextShape, isLineLikeShape } from "../../models/lineFeatures";

const BASE_FONT_SIZE = 17;
const BASE_CELL_WIDTH = 8;
const BASE_CELL_HEIGHT = 16;
const scaleCanvasMetric = (metric: number, scale: number) =>
  Math.max(1, Math.ceil(metric * scale));

export const FONT_SIZE = 18;
export const TEXT_FONT_SIZE = FONT_SIZE;
const FONT_SCALE = FONT_SIZE / BASE_FONT_SIZE;
export const CELL_WIDTH = scaleCanvasMetric(BASE_CELL_WIDTH, FONT_SCALE);
export const CELL_HEIGHT = scaleCanvasMetric(BASE_CELL_HEIGHT, FONT_SCALE);

export const FONT_FAMILY = '"Terminus (TTF)", monospace';
export const TEXT_FONT_FAMILY = FONT_FAMILY;
export const DRAWING_FONT_FAMILY = FONT_FAMILY;
export const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;
export const TEXT_FONT = `${TEXT_FONT_SIZE}px ${TEXT_FONT_FAMILY}`;
export const DRAWING_FONT = `${FONT_SIZE}px ${DRAWING_FONT_FAMILY}`;
const BORDERLESS_SOLID_EDGE_INSET_PX = 0;
// Overlap filled cells a little so subpixel antialiasing cannot reveal the grid
// between adjacent cells inside large solid areas.
const SOLID_FILL_OVERLAP_PX = 0.75;
const BLOCK_SEGMENT_OVERLAP_PX = 0.75;

function setBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function drawGridDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number
) {
  const px = Math.round(x - size * 0.5);
  const py = Math.round(y - size * 0.5);
  ctx.fillStyle = color;
  ctx.fillRect(px, py, size, size);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  _canvasWidth: number,
  _canvasHeight: number,
  rowCount: number,
  colCount: number,
  color: string,
  options?: {
    horizontalSubdivisionColor?: string;
    horizontalSubdivisionAlpha?: number;
    lineWidth?: number;
  }
) {
  const mainDotSize = Math.max(1, options?.lineWidth ?? 2);
  _.forEach(_.range(0, rowCount + 1), (row) => {
    _.forEach(_.range(0, colCount + 1), (col) => {
      drawGridDot(
        ctx,
        col * CELL_WIDTH,
        row * CELL_HEIGHT,
        color,
        mainDotSize
      );
    });
  });

  if (options?.horizontalSubdivisionColor) {
    const subdivisionDotSize = 1;
    ctx.save();
    ctx.globalAlpha = options.horizontalSubdivisionAlpha ?? 0.6;
    _.forEach(_.range(0, rowCount), (row) => {
      _.forEach(_.range(0, colCount + 1), (col) => {
        drawGridDot(
          ctx,
          col * CELL_WIDTH,
          row * CELL_HEIGHT + CELL_HEIGHT * 0.5,
          options.horizontalSubdivisionColor as string,
          subdivisionDotSize
        );
      });
    });
    ctx.restore();
  }
}

function drawSelectBox(
  ctx: CanvasRenderingContext2D,
  boxTL: Coords,
  boxBR: Coords,
  color: string
) {
  ctx.strokeStyle = color;
  ctx.setLineDash([2, 2]);
  ctx.lineWidth = 1;

  // Draw the unfilled rectangle
  ctx.strokeRect(
    boxTL.c * CELL_WIDTH,
    boxTL.r * CELL_HEIGHT,
    (boxBR.c - boxTL.c) * CELL_WIDTH,
    (boxBR.r - boxTL.r) * CELL_HEIGHT
  );
}

function drawBoundingBox(
  ctx: CanvasRenderingContext2D,
  bounds: BoundingBox,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeRect(
    bounds.left * CELL_WIDTH,
    bounds.top * CELL_HEIGHT,
    (bounds.right - bounds.left) * CELL_WIDTH,
    (bounds.bottom - bounds.top) * CELL_HEIGHT
  );
  ctx.restore();
}

function drawBoundingBoxResizePoints(
  ctx: CanvasRenderingContext2D,
  bounds: BoundingBox,
  color: string
) {
  getBoundingBoxResizePoints(bounds).forEach(({ coords: { r, c } }) => {
    ctx.beginPath();
    ctx.arc(
      c * CELL_WIDTH + 0.5 * CELL_WIDTH,
      r * CELL_HEIGHT + 0.5 * CELL_HEIGHT,
      0.5 * CELL_HEIGHT,
      0,
      Math.PI * 2
    );
    ctx.save();
    ctx.globalAlpha = 0.66;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    ctx.closePath();
  });
}

function drawHoveredCell(ctx: CanvasRenderingContext2D, cell: Coords) {
  ctx.fillStyle = "LightBlue";
  ctx.fillRect(
    cell.c * CELL_WIDTH,
    cell.r * CELL_HEIGHT,
    CELL_WIDTH,
    CELL_HEIGHT
  );
}

function drawBindingShapeOutline(
  ctx: CanvasRenderingContext2D,
  bounds: BoundingBox,
  color: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  ctx.strokeRect(
    bounds.left * CELL_WIDTH + 1,
    bounds.top * CELL_HEIGHT + 1,
    Math.max(CELL_WIDTH, (bounds.right - bounds.left + 1) * CELL_WIDTH - 2),
    Math.max(CELL_HEIGHT, (bounds.bottom - bounds.top + 1) * CELL_HEIGHT - 2)
  );
  ctx.restore();
}

function drawBindingAnchor(
  ctx: CanvasRenderingContext2D,
  cell: Coords,
  color: string
) {
  const centerX = cell.c * CELL_WIDTH + CELL_WIDTH * 0.5;
  const centerY = cell.r * CELL_HEIGHT + CELL_HEIGHT * 0.5;
  ctx.save();
  ctx.fillStyle = `${color}22`;
  ctx.fillRect(cell.c * CELL_WIDTH, cell.r * CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    cell.c * CELL_WIDTH + 1,
    cell.r * CELL_HEIGHT + 1,
    Math.max(1, CELL_WIDTH - 2),
    Math.max(1, CELL_HEIGHT - 2)
  );
  ctx.beginPath();
  ctx.fillStyle = color;
  ctx.arc(centerX, centerY, Math.max(3, CELL_HEIGHT * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPathPointHandle(
  ctx: CanvasRenderingContext2D,
  cell: Coords,
  color: string,
  selected = false
) {
  const centerX = cell.c * CELL_WIDTH + CELL_WIDTH * 0.5;
  const centerY = cell.r * CELL_HEIGHT + CELL_HEIGHT * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.max(4, CELL_HEIGHT * (selected ? 0.28 : 0.22)), 0, Math.PI * 2);
  ctx.fillStyle = selected ? color : `${color}55`;
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function drawBlockCursor(
  ctx: CanvasRenderingContext2D,
  cell: Coords,
  _color: string
) {
  const x = Math.round(cell.c * CELL_WIDTH);
  const y = Math.round(cell.r * CELL_HEIGHT);
  const w = Math.max(1, Math.ceil(CELL_WIDTH));
  const h = Math.max(1, Math.ceil(CELL_HEIGHT));
  ctx.save();
  // Terminal-style block cursor with fixed high-contrast colors.
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
  ctx.restore();
}

export type DrawOptions = {
  color: string;
  drawResizePoints: boolean;
  renderRectangleLabelAsEditor?: boolean;
  renderRectangleBorderLabelAsEditor?: boolean;
  rectangleBorderLabelEditorText?: string;
  renderLineLabelAsEditor?: boolean;
};

type CellGraphicElemMap = {
  [key: number]: {
    [key: number]: {
      char?: string;
      charColor?: string;
      blockBorderSegment?:
        | "TOP"
        | "RIGHT"
        | "BOTTOM"
        | "LEFT"
        | "TOP_LEFT"
        | "TOP_RIGHT"
        | "BOTTOM_RIGHT"
        | "BOTTOM_LEFT";
      clearGridUnderlay?: boolean;
      fillColor?: string;
      fillInset?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
    };
  };
};

function getContrastTextColor(backgroundColor: string): string {
  const hex = backgroundColor.trim();
  const normalized =
    hex.startsWith("#") && hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;

  const match = normalized.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return "#f9fafb";

  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.6 ? "#111827" : "#f9fafb";
}

function drawBlockBorderSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  segment: NonNullable<
    CellGraphicElemMap[number][number]["blockBorderSegment"]
  >
) {
  const halfW = CELL_WIDTH / 2;
  const halfH = CELL_HEIGHT / 2;
  ctx.fillStyle = color;
  switch (segment) {
    case "TOP":
      ctx.fillRect(x, y + halfH, CELL_WIDTH, CELL_HEIGHT - halfH);
      return;
    case "RIGHT":
      ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
      return;
    case "BOTTOM":
      ctx.fillRect(x, y, CELL_WIDTH, halfH);
      return;
    case "LEFT":
      ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
      return;
    case "TOP_LEFT":
      ctx.fillRect(x, y + halfH, CELL_WIDTH, CELL_HEIGHT - halfH);
      return;
    case "TOP_RIGHT":
      ctx.fillRect(x, y + halfH, CELL_WIDTH, CELL_HEIGHT - halfH);
      return;
    case "BOTTOM_RIGHT":
      ctx.fillRect(x, y, CELL_WIDTH, halfH);
      return;
    case "BOTTOM_LEFT":
      ctx.fillRect(x, y, CELL_WIDTH, halfH);
      return;
  }
}

function getGraphicCanvasRepresentation(
  shapes: ShapeObject[] | Shape[],
  styleMode: StyleMode,
  globalStyle: Style,
  drawOpts: DrawOptions[]
): CellGraphicElemMap {
  function isShapeObject(shape: ShapeObject | Shape): shape is ShapeObject {
    return "id" in shape;
  }

  let graphicCanvasRepr: CellGraphicElemMap = {};

  shapes.forEach((s, idx) => {
    const shape = isShapeObject(s) ? s.shape : s;
    const shapeStyle = isShapeObject(s) ? s.style : undefined;
    const color = drawOpts[idx].color;
    const mergedStyle: Style = {
      ...globalStyle,
      ...(shapeStyle ?? {}),
    };
    const rectangleBorderMode =
      shape.type === "RECTANGLE" ? resolveRectangleBorder(mergedStyle) : "LINE";

    const abstractShapeRepr: CellValueMap = getAbstractShapeRepresentation(shape);

    const graphicShapeRepr: CellGraphicElemMap = {};
    for (const row in abstractShapeRepr) {
      graphicShapeRepr[row] = {};
      for (const col in abstractShapeRepr[row]) {
        const abstractChar = abstractShapeRepr[row][col];
        const isRectBorderChar =
          shape.type === "RECTANGLE" && isRectangleBorderChar(abstractChar);

        if (isRectBorderChar && rectangleBorderMode === "NONE") {
          continue;
        }

        if (isRectBorderChar && rectangleBorderMode === "BLOCK") {
          const blockBorderChar =
            Number(row) === shape.tl.r && Number(col) === shape.tl.c
              ? "BLOCK_CORNER_TL"
              : Number(row) === shape.tl.r && Number(col) === shape.br.c
                ? "BLOCK_CORNER_TR"
                : Number(row) === shape.br.r && Number(col) === shape.br.c
                  ? "BLOCK_CORNER_BR"
                  : Number(row) === shape.br.r && Number(col) === shape.tl.c
                    ? "BLOCK_CORNER_BL"
                    : Number(row) === shape.tl.r
                      ? "BLOCK_BORDER_TOP"
                      : Number(row) === shape.br.r
                        ? "BLOCK_BORDER_BOTTOM"
                    : Number(col) === shape.tl.c
                          ? "BLOCK_BORDER_LEFT"
                          : "BLOCK_BORDER_RIGHT";
          const blockBorderSegment =
            Number(row) === shape.tl.r && Number(col) === shape.tl.c
              ? "TOP_LEFT"
              : Number(row) === shape.tl.r && Number(col) === shape.br.c
                ? "TOP_RIGHT"
                : Number(row) === shape.br.r && Number(col) === shape.br.c
                  ? "BOTTOM_RIGHT"
                  : Number(row) === shape.br.r && Number(col) === shape.tl.c
                    ? "BOTTOM_LEFT"
                    : Number(row) === shape.tl.r
                      ? "TOP"
                      : Number(row) === shape.br.r
                        ? "BOTTOM"
                        : Number(col) === shape.tl.c
                          ? "LEFT"
                          : "RIGHT";
          graphicShapeRepr[row][col] = {
            char: getCharRepr(blockBorderChar, {
              styleMode,
              globalStyle,
              shapeStyle,
            }),
            charColor: color,
            blockBorderSegment,
          };
          continue;
        }

        const styledChar = getCharRepr(abstractChar, {
          styleMode,
          globalStyle,
          shapeStyle,
        });
        const borderColor = color;
        graphicShapeRepr[row][col] = {
          char: styledChar,
          charColor: borderColor,
        };
      }
    }
    if (shape.type === "RECTANGLE" && mergedStyle.rectangleFill === "SOLID") {
      const canInset =
        shape.br.r - shape.tl.r >= 2 && shape.br.c - shape.tl.c >= 2;
      const insetCells =
        rectangleBorderMode === "LINE"
          ? 1
          : rectangleBorderMode === "BLOCK"
          ? 1
          : rectangleBorderMode === "NONE" && canInset
          ? 1
          : 0;
      const fromR = shape.tl.r + insetCells;
      const toR = shape.br.r - insetCells;
      const fromC = shape.tl.c + insetCells;
      const toC = shape.br.c - insetCells;

      for (let r = fromR; r <= toR; r++) {
        if (!graphicShapeRepr[r]) {
          graphicShapeRepr[r] = {};
        }
        for (let c = fromC; c <= toC; c++) {
          if (!graphicShapeRepr[r][c]) {
            graphicShapeRepr[r][c] = {};
          }
          graphicShapeRepr[r][c].fillColor = color;
          graphicShapeRepr[r][c].fillInset =
            rectangleBorderMode === "NONE"
              ? {
                  top:
                    r === fromR ? BORDERLESS_SOLID_EDGE_INSET_PX : 0,
                  right:
                    c === toC ? BORDERLESS_SOLID_EDGE_INSET_PX : 0,
                  bottom:
                    r === toR ? BORDERLESS_SOLID_EDGE_INSET_PX : 0,
                  left:
                    c === fromC ? BORDERLESS_SOLID_EDGE_INSET_PX : 0,
                }
              : { top: 0, right: 0, bottom: 0, left: 0 };
        }
      }
    }

    if (shape.type === "RECTANGLE") {
      const borderLabelText = drawOpts[idx].renderRectangleBorderLabelAsEditor
        ? ""
        : shape.label ?? "";
      if (borderLabelText.trim().length > 0) {
        const borderLabelRepr: CellValueMap = getRectangleBorderLabelCellValueMap(
          shape,
          borderLabelText
        );
        for (const row in borderLabelRepr) {
          if (!graphicShapeRepr[row]) {
            graphicShapeRepr[row] = {};
          }
          for (const col in borderLabelRepr[row]) {
            const labelChar = borderLabelRepr[row][col];
            if (!graphicShapeRepr[row][col]) {
              graphicShapeRepr[row][col] = {};
            }
            if (rectangleBorderMode === "BLOCK") {
              delete graphicShapeRepr[row][col].blockBorderSegment;
            }
            graphicShapeRepr[row][col].char = labelChar;
            graphicShapeRepr[row][col].charColor = color;
          }
        }
      }
    }

    if (
      shape.type === "RECTANGLE" &&
      rectangleBorderMode === "BLOCK" &&
      drawOpts[idx].renderRectangleBorderLabelAsEditor
    ) {
      const start = getRectangleBorderLabelStart(shape);
      const maxWidth = getRectangleBorderLabelWidth(shape);
      const liveEditorText = drawOpts[idx].rectangleBorderLabelEditorText ?? shape.label ?? "";
      const visibleWidth = Math.max(
        1,
        Math.min(maxWidth, Array.from(liveEditorText).length)
      );
      const cutoutStartCol = Math.max(start.col, shape.tl.c + 1);
      const cutoutEndCol = Math.min(
        start.col + visibleWidth,
        shape.br.c - 1
      );
      if (!graphicShapeRepr[start.row]) {
        graphicShapeRepr[start.row] = {};
      }
      for (let col = cutoutStartCol; col <= cutoutEndCol; col++) {
        if (!graphicShapeRepr[start.row][col]) {
          graphicShapeRepr[start.row][col] = {};
        }
        delete graphicShapeRepr[start.row][col].blockBorderSegment;
        delete graphicShapeRepr[start.row][col].char;
        delete graphicShapeRepr[start.row][col].charColor;
      }
    }

    if (
      shape.type === "RECTANGLE" &&
      shape.labelLines &&
      shape.labelLines.some((line) => line.length > 0)
    ) {
      if (!drawOpts[idx].renderRectangleLabelAsEditor) {
        const labelRepr: CellValueMap = getRectangleLabelCellValueMap(
          shape,
          shape.labelLines,
          {
            alignH: mergedStyle.rectangleTextAlignH,
            alignV: mergedStyle.rectangleTextAlignV,
            overflow: mergedStyle.rectangleTextOverflow,
            padding: mergedStyle.rectangleTextPadding,
          }
        );
        for (const row in labelRepr) {
          if (!graphicShapeRepr[row]) {
            graphicShapeRepr[row] = {};
          }
          for (const col in labelRepr[row]) {
            const labelChar = labelRepr[row][col];
            if (!graphicShapeRepr[row][col]) {
              graphicShapeRepr[row][col] = {};
            }
            graphicShapeRepr[row][col].char = labelChar;
            graphicShapeRepr[row][col].charColor =
              mergedStyle.rectangleFill === "SOLID" && /\S/u.test(labelChar)
                ? getContrastTextColor(color)
                : color;
          }
        }
      }
    }

    if (isLineLikeShape(shape) && !drawOpts[idx].renderLineLabelAsEditor) {
      const labelShape = getLineLabelTextShape(shape, {
        lineTextAlign: mergedStyle.lineTextAlign,
        lineTextPadding: mergedStyle.lineTextPadding,
      });
      if (labelShape) {
        const labelRepr = getAbstractShapeRepresentation(labelShape);
        for (const row in labelRepr) {
          if (!graphicShapeRepr[row]) {
            graphicShapeRepr[row] = {};
          }
          for (const col in labelRepr[row]) {
            const labelChar = labelRepr[row][col];
            if (!/\S/u.test(labelChar)) {
              continue;
            }
            if (!graphicShapeRepr[row][col]) {
              graphicShapeRepr[row][col] = {};
            }
            graphicShapeRepr[row][col].char = labelChar;
            graphicShapeRepr[row][col].charColor = color;
          }
        }
      }
    }

    for (const row in graphicShapeRepr) {
      if (!graphicCanvasRepr[row]) {
        graphicCanvasRepr[row] = {};
      }
      for (const col in graphicShapeRepr[row]) {
        const nextCell = graphicShapeRepr[row][col];
        const prevCell = graphicCanvasRepr[row][col] ?? {};
        const mergedCell = { ...prevCell };

        if (nextCell.fillColor) {
          mergedCell.fillColor = nextCell.fillColor;
          mergedCell.fillInset = nextCell.fillInset ?? {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          };
        }
        if (nextCell.clearGridUnderlay) {
          mergedCell.clearGridUnderlay = true;
        }
        if (nextCell.blockBorderSegment) {
          mergedCell.blockBorderSegment = nextCell.blockBorderSegment;
        }
        if (nextCell.char && nextCell.char.length > 0) {
          mergedCell.char = nextCell.char;
          if (/\S/u.test(nextCell.char) && mergedCell.fillColor) {
            mergedCell.charColor = getContrastTextColor(mergedCell.fillColor);
          } else {
            mergedCell.charColor = nextCell.charColor;
          }
        }

        graphicCanvasRepr[row][col] = mergedCell;
      }
    }
  });

  return graphicCanvasRepr;
}

function isRectangleBorderChar(char: Char): boolean {
  return (
    char === "LINE_HORIZONTAL" ||
    char === "LINE_VERTICAL" ||
    char === "CORNER_TR" ||
    char === "CORNER_TL" ||
    char === "CORNER_BR" ||
    char === "CORNER_BL"
  );
}

function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: ShapeObject[] | Shape[],
  styleMode: StyleMode,
  globalStyle: Style,
  opts: DrawOptions[],
  canvasBackground: string
): void {
  if (shapes.length === 0) return;

  const repr: CellGraphicElemMap = getGraphicCanvasRepresentation(
    shapes,
    styleMode,
    globalStyle,
    opts
  );

  ctx.textBaseline = "middle"; // To align the text in the middle of the cell (the default value "alphabetic" does not align the text in the middle)
  let activeFont = "";
  for (const row in repr) {
    for (const col in repr[row]) {
      const {
        char,
        charColor,
        fillColor,
        clearGridUnderlay,
        blockBorderSegment,
      } = repr[row][col];
      const fillInset = repr[row][col].fillInset ?? {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      };
      const x = parseInt(col) * CELL_WIDTH;
      const y = parseInt(row) * CELL_HEIGHT;
      if (clearGridUnderlay) {
        ctx.fillStyle = canvasBackground;
        ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
      }
      if (fillColor) {
        ctx.fillStyle = fillColor;
        const xWithOverlap = x + fillInset.left - SOLID_FILL_OVERLAP_PX;
        const yWithOverlap = y + fillInset.top - SOLID_FILL_OVERLAP_PX;
        const w = Math.max(
          0,
          CELL_WIDTH -
            fillInset.left -
            fillInset.right +
            SOLID_FILL_OVERLAP_PX * 2
        );
        const h = Math.max(
          0,
          CELL_HEIGHT -
            fillInset.top -
            fillInset.bottom +
            SOLID_FILL_OVERLAP_PX * 2
        );
        if (w > 0 && h > 0) {
          ctx.fillRect(xWithOverlap, yWithOverlap, w, h);
        }
      }
      if (blockBorderSegment) {
        drawBlockBorderSegment(
          ctx,
          x,
          y,
          charColor ?? "#ffffff",
          blockBorderSegment
        );
      }
      if (char && char.length > 0) {
        const nextFont = FONT;
        if (activeFont !== nextFont) {
          ctx.font = nextFont;
          activeFont = nextFont;
        }
        ctx.fillStyle = charColor ?? "#ffffff";
        ctx.fillText(
          char,
          x,
          y + 0.5 * CELL_HEIGHT
        );
      }
    }
  }

  // Draw resize points
  function isShapeObject(shape: ShapeObject | Shape): shape is ShapeObject {
    return "id" in shape;
  }
  shapes.forEach((s, idx) => {
    if (opts[idx].drawResizePoints) {
      const resizePoints: ResizePoint[] = getResizePoints(
        isShapeObject(s) ? s.shape : s
      );
      resizePoints.forEach(({ coords: { r, c } }) => {
        ctx.beginPath(); // Start a new path
        ctx.arc(
          c * CELL_WIDTH + 0.5 * CELL_WIDTH,
          r * CELL_HEIGHT + 0.5 * CELL_HEIGHT,
          0.5 * CELL_HEIGHT,
          0,
          Math.PI * 2
        ); // Create a circular path
        ctx.save();
        ctx.globalAlpha = 0.66;
        ctx.fillStyle = opts[idx].color; // Set the fill color
        ctx.fill(); // Fill the path with the color
        ctx.restore();
        ctx.closePath(); // Close the path
      });
    }
  });
}

export const canvasDraw = {
  setBackground,
  drawGrid,
  drawHoveredCell,
  drawBindingShapeOutline,
  drawBindingAnchor,
  drawPathPointHandle,
  drawBlockCursor,
  drawShapes,
  drawSelectBox,
  drawBoundingBox,
  drawBoundingBoxResizePoints,
};
