import { v4 as uuidv4 } from "uuid";
import { getBoundingBox } from "@/components/asciip-core/models/shapeInCanvas";
import { translateUnbounded } from "@/components/asciip-core/models/transformation";
import type { Coords, Shape } from "@/components/asciip-core/models/shapes";
import type { ShapeObject } from "@/components/asciip-core/store/diagramSlice";

export type PortalRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type PortalCreationMode = "new-canvas" | "same-canvas";
export type LinkedViewType = "portal" | "component";

export type CanvasPortalView = {
  id: string;
  canvasId: string;
  label: string;
  viewType?: LinkedViewType;
  rect: PortalRect;
  color: string;
  componentProps?: Record<string, string>;
  target: {
    documentId: string | null;
    canvasId: string;
    top: number;
    left: number;
  };
  createdAt: string;
  updatedAt: string;
};

const PORTAL_VIEW_COLOR_PALETTE = ["#38bdf8", "#a855f7", "#22c55e", "#f97316"];

export function createPortalView(input: {
  canvasId: string;
  rect: PortalRect;
  target?: {
    documentId?: string | null;
    canvasId?: string;
    top?: number;
    left?: number;
  };
  label?: string;
  index?: number;
  now?: string;
}): CanvasPortalView {
  const now = input.now ?? new Date().toISOString();
  const index = input.index ?? 0;
  return {
    id: uuidv4(),
    canvasId: input.canvasId,
    label: input.label?.trim() || `Portal ${index + 1}`,
    viewType: "portal",
    rect: input.rect,
    color: PORTAL_VIEW_COLOR_PALETTE[index % PORTAL_VIEW_COLOR_PALETTE.length],
    target: {
      documentId: input.target?.documentId ?? null,
      canvasId: input.target?.canvasId ?? input.canvasId,
      top: input.target?.top ?? input.rect.top,
      left: input.target?.left ?? input.rect.left,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function createComponentView(input: {
  canvasId: string;
  sourceCanvasId: string;
  rect: PortalRect;
  documentId?: string | null;
  label?: string;
  color?: string;
  componentProps?: Record<string, string>;
  now?: string;
}): CanvasPortalView {
  const now = input.now ?? new Date().toISOString();
  return {
    id: uuidv4(),
    canvasId: input.canvasId,
    label: input.label?.trim() || "Component",
    viewType: "component",
    rect: input.rect,
    color: input.color ?? "#f59e0b",
    componentProps: input.componentProps ?? {},
    target: {
      documentId: input.documentId ?? null,
      canvasId: input.sourceCanvasId,
      top: 0,
      left: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function getPortalTargetRect(portal: CanvasPortalView): PortalRect {
  return {
    top: portal.target.top,
    left: portal.target.left,
    width: portal.rect.width,
    height: portal.rect.height,
  };
}

export function isPointWithinPortalRect(rect: PortalRect, coords: Coords) {
  return (
    coords.r >= rect.top &&
    coords.r < rect.top + rect.height &&
    coords.c >= rect.left &&
    coords.c < rect.left + rect.width
  );
}

export function isShapeFullyWithinPortalRect(shape: Shape, rect: PortalRect) {
  const bounds = getBoundingBox(shape);
  return (
    bounds.top >= rect.top &&
    bounds.left >= rect.left &&
    bounds.bottom < rect.top + rect.height &&
    bounds.right < rect.left + rect.width
  );
}

export function mapPointFromPortalToTarget(portal: CanvasPortalView, coords: Coords): Coords {
  return {
    r: portal.target.top + (coords.r - portal.rect.top),
    c: portal.target.left + (coords.c - portal.rect.left),
  };
}

export function mapPointFromTargetToPortal(portal: CanvasPortalView, coords: Coords): Coords {
  return {
    r: portal.rect.top + (coords.r - portal.target.top),
    c: portal.rect.left + (coords.c - portal.target.left),
  };
}

export function mirrorShapeIntoPortal(shape: Shape, portal: CanvasPortalView): Shape {
  return translateUnbounded(shape, {
    r: portal.rect.top - portal.target.top,
    c: portal.rect.left - portal.target.left,
  });
}

function scalePortalCoordinate(offset: number, sourceSize: number, targetStart: number, targetSize: number) {
  if (sourceSize <= 1) {
    return targetStart;
  }
  const ratio = offset / Math.max(1, sourceSize - 1);
  return Math.round(targetStart + ratio * Math.max(0, targetSize - 1));
}

function scalePointIntoPortal(
  point: Coords,
  sourceSize: { rows: number; cols: number },
  portal: CanvasPortalView,
): Coords {
  return {
    r: scalePortalCoordinate(point.r - portal.target.top, sourceSize.rows, portal.rect.top, portal.rect.height),
    c: scalePortalCoordinate(point.c - portal.target.left, sourceSize.cols, portal.rect.left, portal.rect.width),
  };
}

function scaleShapeIntoPortal(
  shape: Shape,
  sourceSize: { rows: number; cols: number },
  portal: CanvasPortalView,
): Shape {
  switch (shape.type) {
    case "RECTANGLE":
      return {
        ...shape,
        tl: scalePointIntoPortal(shape.tl, sourceSize, portal),
        br: scalePointIntoPortal(shape.br, sourceSize, portal),
      };
    case "LINE":
      return {
        ...shape,
        start: scalePointIntoPortal(shape.start, sourceSize, portal),
        end: scalePointIntoPortal(shape.end, sourceSize, portal),
      };
    case "MULTI_SEGMENT_LINE":
      return {
        ...shape,
        segments: shape.segments.map((segment) => ({
          ...segment,
          start: scalePointIntoPortal(segment.start, sourceSize, portal),
          end: scalePointIntoPortal(segment.end, sourceSize, portal),
        })),
      };
    case "TEXT":
      return {
        ...shape,
        start: scalePointIntoPortal(shape.start, sourceSize, portal),
      };
  }
}

function applyTemplate(input: string, props: Record<string, string>) {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    return props[key] ?? `{{${key}}}`;
  });
}

function applyComponentPropsToShape(shape: Shape, props: Record<string, string>): Shape {
  if (shape.type === "TEXT") {
    return {
      ...shape,
      lines: (shape.lines ?? []).map((line) => applyTemplate(line, props)),
    };
  }

  if (shape.type === "RECTANGLE") {
    return {
      ...shape,
      label: shape.label ? applyTemplate(shape.label, props) : shape.label,
      labelLines: (shape.labelLines ?? []).map((line) => applyTemplate(line, props)),
    };
  }

  if (shape.type === "LINE" || shape.type === "MULTI_SEGMENT_LINE") {
    return {
      ...shape,
      labelLines: (shape.labelLines ?? []).map((line) => applyTemplate(line, props)),
    };
  }

  return shape;
}

export function createPortalPreviewShapes(input: {
  portal: CanvasPortalView;
  shapes: ShapeObject[];
  includeShapeIds?: Set<string> | null;
  resolvedComponentProps?: Record<string, string>;
  sourceCanvasSize?: {
    rows: number;
    cols: number;
  } | null;
}): ShapeObject[] {
  const targetRect = getPortalTargetRect(input.portal);
  return input.shapes.flatMap((shapeObj) => {
    if (!isShapeFullyWithinPortalRect(shapeObj.shape, targetRect)) {
      return [];
    }
    if (input.includeShapeIds && !input.includeShapeIds.has(shapeObj.id)) {
      return [];
    }
    const nextShape =
      input.portal.viewType === "component"
        ? applyComponentPropsToShape(
            shapeObj.shape,
            input.resolvedComponentProps ?? input.portal.componentProps ?? {}
          )
        : shapeObj.shape;
    const renderedShape =
      input.portal.viewType === "component" && input.sourceCanvasSize
        ? scaleShapeIntoPortal(nextShape, input.sourceCanvasSize, input.portal)
        : mirrorShapeIntoPortal(nextShape, input.portal);
    return [{
      ...shapeObj,
      id: `portal-preview:${input.portal.id}:${shapeObj.id}`,
      shape: renderedShape,
      style: shapeObj.style,
    }];
  });
}
