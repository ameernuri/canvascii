import _ from "lodash";
import {
  Coords,
  getHorizontalDirection,
  getVerticalDirection,
  isClosedMultiSegmentLine,
  Line,
  MultiSegment,
  normalizeMultiSegmentLine,
  Segment,
  Shape,
  ShapeBorderBinding,
  ShapeBorderSide,
  TextShape,
} from "./shapes";
import { BoundingBox, getBoundingBox } from "./shapeInCanvas";
import { Style } from "./style";
import { createLineSegment } from "./create";

export type LineTextAlign = "START" | "CENTER" | "END";

type BindableShape = Extract<Shape, { type: "RECTANGLE" | "TEXT" }>;

export type BindableShapeHit = {
  shapeId: string;
  shape: BindableShape;
  binding: ShapeBorderBinding;
  anchor: Coords;
};

export type MultiSegmentPointHandle = {
  pointIndex: number;
  coords: Coords;
};

export function isLineLikeShape(shape: Shape): shape is Line | MultiSegment {
  return shape.type === "LINE" || shape.type === "MULTI_SEGMENT_LINE";
}

export function getLineLabelLines(shape: Shape): string[] {
  if (!isLineLikeShape(shape)) return [];
  return shape.labelLines ?? [];
}

export function getBindableShapeBounds(shape: BindableShape): BoundingBox {
  return getBoundingBox(shape);
}

export function isCoordsInsideBindableShape(shape: BindableShape, coords: Coords): boolean {
  const bounds = getBindableShapeBounds(shape);
  return (
    coords.r >= bounds.top &&
    coords.r <= bounds.bottom &&
    coords.c >= bounds.left &&
    coords.c <= bounds.right
  );
}

export function isCoordsOnBindableShapeBorder(shape: BindableShape, coords: Coords): boolean {
  const bounds = getBindableShapeBounds(shape);
  if (!isCoordsInsideBindableShape(shape, coords)) {
    return false;
  }

  return (
    coords.r === bounds.top ||
    coords.r === bounds.bottom ||
    coords.c === bounds.left ||
    coords.c === bounds.right
  );
}

export function createShapeBorderBinding(
  shapeId: string,
  shape: BindableShape,
  coords: Coords,
  options?: {
    allowInterior?: boolean;
    locked?: boolean;
  },
): ShapeBorderBinding | null {
  if (!isCoordsInsideBindableShape(shape, coords)) {
    return null;
  }

  if (!isCoordsOnBindableShapeBorder(shape, coords)) {
    if (!options?.allowInterior) {
      return null;
    }

    return getNearestBindingToCoords(shapeId, shape, coords, {
      locked: options.locked,
    });
  }

  const bounds = getBindableShapeBounds(shape);
  const horizontalSpan = Math.max(1, bounds.right - bounds.left);
  const verticalSpan = Math.max(1, bounds.bottom - bounds.top);

  if (coords.r === bounds.top) {
    return {
      targetShapeId: shapeId,
      side: "TOP",
      position: (coords.c - bounds.left) / horizontalSpan,
      locked: options?.locked,
    };
  }
  if (coords.r === bounds.bottom) {
    return {
      targetShapeId: shapeId,
      side: "BOTTOM",
      position: (coords.c - bounds.left) / horizontalSpan,
      locked: options?.locked,
    };
  }
  if (coords.c === bounds.left) {
    return {
      targetShapeId: shapeId,
      side: "LEFT",
      position: (coords.r - bounds.top) / verticalSpan,
      locked: options?.locked,
    };
  }
  if (coords.c === bounds.right) {
    return {
      targetShapeId: shapeId,
      side: "RIGHT",
      position: (coords.r - bounds.top) / verticalSpan,
      locked: options?.locked,
    };
  }

  return null;
}

export function resolveShapeBorderBinding(
  binding: ShapeBorderBinding,
  shape: BindableShape,
): Coords {
  const bounds = getBindableShapeBounds(shape);
  const normalized = Math.max(0, Math.min(1, binding.position));

  switch (binding.side) {
    case "TOP":
      return {
        r: bounds.top,
        c: bounds.left + Math.round((bounds.right - bounds.left) * normalized),
      };
    case "BOTTOM":
      return {
        r: bounds.bottom,
        c: bounds.left + Math.round((bounds.right - bounds.left) * normalized),
      };
    case "LEFT":
      return {
        r: bounds.top + Math.round((bounds.bottom - bounds.top) * normalized),
        c: bounds.left,
      };
    case "RIGHT":
      return {
        r: bounds.top + Math.round((bounds.bottom - bounds.top) * normalized),
        c: bounds.right,
      };
  }
}

export function bindLineEndpointAtCoords(
  shapeObjects: { id: string; shape: Shape }[],
  coords: Coords,
): ShapeBorderBinding | undefined {
  return getBindableShapeHitAtCoords(shapeObjects, coords)?.binding;
}

export function getBindableShapeHitAtCoords(
  shapeObjects: { id: string; shape: Shape }[],
  coords: Coords,
): BindableShapeHit | null {
  const target = [...shapeObjects]
    .reverse()
    .find((shapeObj) => {
      return (
        (shapeObj.shape.type === "RECTANGLE" || shapeObj.shape.type === "TEXT") &&
        isCoordsInsideBindableShape(shapeObj.shape, coords)
      );
    });

  if (!target || (target.shape.type !== "RECTANGLE" && target.shape.type !== "TEXT")) {
    return null;
  }

  const binding = createShapeBorderBinding(target.id, target.shape, coords, {
    allowInterior: true,
  });
  if (!binding) {
    return null;
  }

  return {
    shapeId: target.id,
    shape: target.shape,
    binding,
    anchor: resolveShapeBorderBinding(binding, target.shape),
  };
}

export function applyShapeBindings(
  shape: Line | MultiSegment,
  shapeLookup: Map<string, Shape>,
  options?: {
    preserveExistingBindings?: boolean;
    forceAutoroute?: boolean;
  },
): Line | MultiSegment {
  const resolveBindableShape = (
    binding: ShapeBorderBinding | undefined,
  ): BindableShape | null => {
    if (!binding) return null;
    const targetShape = shapeLookup.get(binding.targetShapeId);
    if (!targetShape || (targetShape.type !== "RECTANGLE" && targetShape.type !== "TEXT")) {
      return null;
    }
    return targetShape;
  };

  const startShape = resolveBindableShape(shape.startBinding);
  const endShape = resolveBindableShape(shape.endBinding);
  const fallbackStart = shape.type === "LINE" ? shape.start : shape.segments[0]?.start ?? null;
  const fallbackEnd =
    shape.type === "LINE" ? shape.end : shape.segments[shape.segments.length - 1]?.end ?? null;
  const bothBound = Boolean(shape.startBinding && shape.endBinding && startShape && endShape);
  const resolvedStartBinding = (() => {
    if (!shape.startBinding || !startShape) {
      return undefined;
    }
    if (options?.preserveExistingBindings) {
      return shape.startBinding;
    }
    if (shape.startBinding.locked) {
      return shape.startBinding;
    }
    if (bothBound && shape.endBinding && endShape) {
      if (shape.endBinding.locked) {
        const target = resolveShapeBorderBinding(shape.endBinding, endShape);
        return getNearestBindingToCoords(shape.startBinding.targetShapeId, startShape, target);
      }
      return getNearestFacingBindingPair(
        shape.startBinding,
        startShape,
        shape.endBinding,
        endShape,
      ).startBinding;
    }
    return fallbackEnd
      ? getNearestBindingToCoords(shape.startBinding.targetShapeId, startShape, fallbackEnd)
      : shape.startBinding;
  })();
  const resolvedEndBinding = (() => {
    if (!shape.endBinding || !endShape) {
      return undefined;
    }
    if (options?.preserveExistingBindings) {
      return shape.endBinding;
    }
    if (shape.endBinding.locked) {
      return shape.endBinding;
    }
    if (bothBound && shape.startBinding && startShape) {
      if (shape.startBinding.locked) {
        const target = resolveShapeBorderBinding(shape.startBinding, startShape);
        return getNearestBindingToCoords(shape.endBinding.targetShapeId, endShape, target);
      }
      return getNearestFacingBindingPair(
        shape.startBinding,
        startShape,
        shape.endBinding,
        endShape,
      ).endBinding;
    }
    return fallbackStart
      ? getNearestBindingToCoords(shape.endBinding.targetShapeId, endShape, fallbackStart)
      : shape.endBinding;
  })();
  const startCoords =
    resolvedStartBinding && startShape
      ? resolveShapeBorderBinding(resolvedStartBinding, startShape)
      : null;
  const endCoords =
    resolvedEndBinding && endShape ? resolveShapeBorderBinding(resolvedEndBinding, endShape) : null;

  if (!startCoords && !endCoords) {
    return shape;
  }

  if (shape.type === "LINE") {
    const start = startCoords ?? shape.start;
    const end = endCoords ?? shape.end;
    if (Math.abs(end.c - start.c) >= Math.abs(end.r - start.r)) {
      return {
        ...shape,
        startBinding: resolvedStartBinding,
        endBinding: resolvedEndBinding,
        axis: "HORIZONTAL",
        start,
        end: { r: start.r, c: end.c },
        direction: start.c <= end.c ? "LEFT_TO_RIGHT" : "RIGHT_TO_LEFT",
      };
    }
    return {
      ...shape,
      startBinding: resolvedStartBinding,
      endBinding: resolvedEndBinding,
      axis: "VERTICAL",
      start,
      end: { r: end.r, c: start.c },
      direction: start.r <= end.r ? "DOWN" : "UP",
    };
  }

  const next = _.cloneDeep(shape);
  if (next.segments.length === 0) {
    return next;
  }
  next.startBinding = resolvedStartBinding;
  next.endBinding = resolvedEndBinding;

  const canAutorouteBoundPath =
    options?.forceAutoroute || next.segments.length <= 1;

  if (
    canAutorouteBoundPath &&
    startCoords &&
    endCoords &&
    resolvedStartBinding &&
    resolvedEndBinding &&
    startShape &&
    endShape &&
    !next.closed
  ) {
    const reroutedSegments = routeBoundMultiSegment(
      startCoords,
      endCoords,
      resolvedStartBinding,
      resolvedEndBinding,
      startShape,
      endShape,
    );
    if (reroutedSegments) {
      return {
        ...next,
        startBinding: resolvedStartBinding,
        endBinding: resolvedEndBinding,
        segments: reroutedSegments,
      };
    }
  }

  if (startCoords) {
    const firstSegment = next.segments[0];
    firstSegment.start = startCoords;
    if (firstSegment.axis === "HORIZONTAL") {
      firstSegment.end = { ...firstSegment.end, r: startCoords.r };
    } else {
      firstSegment.end = { ...firstSegment.end, c: startCoords.c };
    }
    if (next.segments.length > 1) {
      next.segments[1].start = firstSegment.end;
    }
  }

  if (endCoords) {
    const lastIndex = next.segments.length - 1;
    const lastSegment = next.segments[lastIndex];
    lastSegment.end = endCoords;
    if (lastSegment.axis === "HORIZONTAL") {
      lastSegment.start = { ...lastSegment.start, r: endCoords.r };
    } else {
      lastSegment.start = { ...lastSegment.start, c: endCoords.c };
    }
    if (lastIndex > 0) {
      next.segments[lastIndex - 1].end = lastSegment.start;
    }
  }

  next.segments = next.segments.map((segment) => {
    if (segment.axis === "HORIZONTAL") {
      return {
        ...segment,
        direction: segment.start.c <= segment.end.c ? "LEFT_TO_RIGHT" : "RIGHT_TO_LEFT",
      };
    }
    return {
      ...segment,
      direction: segment.start.r <= segment.end.r ? "DOWN" : "UP",
    };
  });

  return collapseRedundantDoglegs(next);

}

function collapseRedundantDoglegs(shape: MultiSegment): MultiSegment {
  let next = _.cloneDeep(shape);

  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < next.segments.length - 1; index += 1) {
      const first = next.segments[index];
      const second = next.segments[index + 1];
      if (!first || !second || first.axis === second.axis) {
        continue;
      }
      if (!_.isEqual(first.end, second.start)) {
        continue;
      }

      const straightened =
        first.start.r === second.end.r || first.start.c === second.end.c
          ? createLineSegment(first.start, second.end)
          : null;

      if (!straightened || _.isEqual(straightened.start, straightened.end)) {
        continue;
      }

      next = normalizeMultiSegmentLine({
        ...next,
        segments: [
          ...next.segments.slice(0, index),
          straightened,
          ...next.segments.slice(index + 2),
        ],
      });
      changed = true;
      break;
    }
  }

  if (isClosedMultiSegmentLine(next) && next.segments.length > 0) {
    const firstStart = next.segments[0].start;
    const lastIndex = next.segments.length - 1;
    const lastSegment = next.segments[lastIndex];
    next.segments[lastIndex] =
      lastSegment.axis === "HORIZONTAL"
        ? {
            ...lastSegment,
            end: firstStart,
            direction: getHorizontalDirection(lastSegment.start.c, firstStart.c),
          }
        : {
            ...lastSegment,
            end: firstStart,
            direction: getVerticalDirection(lastSegment.start.r, firstStart.r),
          };
  }

  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getShapeCenter(shape: BindableShape): Coords {
  const bounds = getBindableShapeBounds(shape);
  return {
    r: Math.round((bounds.top + bounds.bottom) / 2),
    c: Math.round((bounds.left + bounds.right) / 2),
  };
}

function createBindingOnSide(
  shapeId: string,
  shape: BindableShape,
  side: ShapeBorderSide,
  anchor: Coords,
  locked = false,
): ShapeBorderBinding {
  const bounds = getBindableShapeBounds(shape);
  const horizontalSpan = Math.max(1, bounds.right - bounds.left);
  const verticalSpan = Math.max(1, bounds.bottom - bounds.top);

  switch (side) {
    case "TOP":
      return {
        targetShapeId: shapeId,
        side,
        position: (clamp(anchor.c, bounds.left, bounds.right) - bounds.left) / horizontalSpan,
        locked,
      };
    case "BOTTOM":
      return {
        targetShapeId: shapeId,
        side,
        position: (clamp(anchor.c, bounds.left, bounds.right) - bounds.left) / horizontalSpan,
        locked,
      };
    case "LEFT":
      return {
        targetShapeId: shapeId,
        side,
        position: (clamp(anchor.r, bounds.top, bounds.bottom) - bounds.top) / verticalSpan,
        locked,
      };
    case "RIGHT":
      return {
        targetShapeId: shapeId,
        side,
        position: (clamp(anchor.r, bounds.top, bounds.bottom) - bounds.top) / verticalSpan,
        locked,
      };
  }
}

function getBindingForSideTowardsCoords(
  shapeId: string,
  shape: BindableShape,
  side: ShapeBorderSide,
  target: Coords,
  locked = false,
): ShapeBorderBinding {
  const bounds = getBindableShapeBounds(shape);
  switch (side) {
    case "TOP":
      return createBindingOnSide(shapeId, shape, side, {
        r: bounds.top,
        c: clamp(target.c, bounds.left, bounds.right),
      }, locked);
    case "BOTTOM":
      return createBindingOnSide(shapeId, shape, side, {
        r: bounds.bottom,
        c: clamp(target.c, bounds.left, bounds.right),
      }, locked);
    case "LEFT":
      return createBindingOnSide(shapeId, shape, side, {
        r: clamp(target.r, bounds.top, bounds.bottom),
        c: bounds.left,
      }, locked);
    case "RIGHT":
      return createBindingOnSide(shapeId, shape, side, {
        r: clamp(target.r, bounds.top, bounds.bottom),
        c: bounds.right,
      }, locked);
  }
}

function getNearestBindingToCoords(
  shapeId: string,
  shape: BindableShape,
  target: Coords,
  options?: {
    locked?: boolean;
  },
): ShapeBorderBinding {
  const candidates: ShapeBorderBinding[] = [
    getBindingForSideTowardsCoords(shapeId, shape, "TOP", target, options?.locked),
    getBindingForSideTowardsCoords(shapeId, shape, "RIGHT", target, options?.locked),
    getBindingForSideTowardsCoords(shapeId, shape, "BOTTOM", target, options?.locked),
    getBindingForSideTowardsCoords(shapeId, shape, "LEFT", target, options?.locked),
  ];

  return candidates.reduce((best, candidate) => {
    const bestDistance = _.sum([
      Math.abs(resolveShapeBorderBinding(best, shape).r - target.r),
      Math.abs(resolveShapeBorderBinding(best, shape).c - target.c),
    ]);
    const candidateDistance = _.sum([
      Math.abs(resolveShapeBorderBinding(candidate, shape).r - target.r),
      Math.abs(resolveShapeBorderBinding(candidate, shape).c - target.c),
    ]);
    return candidateDistance < bestDistance ? candidate : best;
  });
}

function getNearestFacingBindingPair(
  startBinding: ShapeBorderBinding,
  startShape: BindableShape,
  endBinding: ShapeBorderBinding,
  endShape: BindableShape,
): {
  startBinding: ShapeBorderBinding;
  endBinding: ShapeBorderBinding;
} {
  const startBounds = getBindableShapeBounds(startShape);
  const endBounds = getBindableShapeBounds(endShape);
  const startCenter = getShapeCenter(startShape);
  const endCenter = getShapeCenter(endShape);

  const pickSharedRow = () => {
    const overlapTop = Math.max(startBounds.top, endBounds.top);
    const overlapBottom = Math.min(startBounds.bottom, endBounds.bottom);
    if (overlapTop <= overlapBottom) {
      return clamp(Math.round((startCenter.r + endCenter.r) / 2), overlapTop, overlapBottom);
    }
    return startCenter.r < endCenter.r ? startBounds.bottom : startBounds.top;
  };

  const pickSharedCol = () => {
    const overlapLeft = Math.max(startBounds.left, endBounds.left);
    const overlapRight = Math.min(startBounds.right, endBounds.right);
    if (overlapLeft <= overlapRight) {
      return clamp(Math.round((startCenter.c + endCenter.c) / 2), overlapLeft, overlapRight);
    }
    return startCenter.c < endCenter.c ? startBounds.right : startBounds.left;
  };

  if (startBounds.right < endBounds.left) {
    const row = pickSharedRow();
    return {
      startBinding: createBindingOnSide(startBinding.targetShapeId, startShape, "RIGHT", {
        r: row,
        c: startBounds.right,
      }),
      endBinding: createBindingOnSide(endBinding.targetShapeId, endShape, "LEFT", {
        r: clamp(row, endBounds.top, endBounds.bottom),
        c: endBounds.left,
      }),
    };
  }

  if (endBounds.right < startBounds.left) {
    const row = pickSharedRow();
    return {
      startBinding: createBindingOnSide(startBinding.targetShapeId, startShape, "LEFT", {
        r: row,
        c: startBounds.left,
      }),
      endBinding: createBindingOnSide(endBinding.targetShapeId, endShape, "RIGHT", {
        r: clamp(row, endBounds.top, endBounds.bottom),
        c: endBounds.right,
      }),
    };
  }

  if (startBounds.bottom < endBounds.top) {
    const col = pickSharedCol();
    return {
      startBinding: createBindingOnSide(startBinding.targetShapeId, startShape, "BOTTOM", {
        r: startBounds.bottom,
        c: col,
      }),
      endBinding: createBindingOnSide(endBinding.targetShapeId, endShape, "TOP", {
        r: endBounds.top,
        c: clamp(col, endBounds.left, endBounds.right),
      }),
    };
  }

  if (endBounds.bottom < startBounds.top) {
    const col = pickSharedCol();
    return {
      startBinding: createBindingOnSide(startBinding.targetShapeId, startShape, "TOP", {
        r: startBounds.top,
        c: col,
      }),
      endBinding: createBindingOnSide(endBinding.targetShapeId, endShape, "BOTTOM", {
        r: endBounds.bottom,
        c: clamp(col, endBounds.left, endBounds.right),
      }),
    };
  }

  return Math.abs(endCenter.c - startCenter.c) >= Math.abs(endCenter.r - startCenter.r)
    ? {
        startBinding: getBindingForSideTowardsCoords(
          startBinding.targetShapeId,
          startShape,
          endCenter.c >= startCenter.c ? "RIGHT" : "LEFT",
          endCenter,
        ),
        endBinding: getBindingForSideTowardsCoords(
          endBinding.targetShapeId,
          endShape,
          startCenter.c >= endCenter.c ? "RIGHT" : "LEFT",
          startCenter,
        ),
      }
    : {
        startBinding: getBindingForSideTowardsCoords(
          startBinding.targetShapeId,
          startShape,
          endCenter.r >= startCenter.r ? "BOTTOM" : "TOP",
          endCenter,
        ),
        endBinding: getBindingForSideTowardsCoords(
          endBinding.targetShapeId,
          endShape,
          startCenter.r >= endCenter.r ? "BOTTOM" : "TOP",
          startCenter,
        ),
      };
}

function getBindingOutsidePoint(binding: ShapeBorderBinding, shape: BindableShape): Coords {
  const anchor = resolveShapeBorderBinding(binding, shape);
  switch (binding.side) {
    case "TOP":
      return { r: anchor.r - 1, c: anchor.c };
    case "BOTTOM":
      return { r: anchor.r + 1, c: anchor.c };
    case "LEFT":
      return { r: anchor.r, c: anchor.c - 1 };
    case "RIGHT":
      return { r: anchor.r, c: anchor.c + 1 };
  }
}

function routeBoundMultiSegment(
  start: Coords,
  end: Coords,
  startBinding: ShapeBorderBinding,
  endBinding: ShapeBorderBinding,
  startShape: BindableShape,
  endShape: BindableShape,
): Segment[] | null {
  const startOut = getBindingOutsidePoint(startBinding, startShape);
  const endOut = getBindingOutsidePoint(endBinding, endShape);
  const startBounds = getBindableShapeBounds(startShape);
  const endBounds = getBindableShapeBounds(endShape);
  const routePoints = findOrthogonalRoute(
    startOut,
    endOut,
    [startBounds, endBounds],
  );
  const fallbackRoutePoints =
    routePoints ?? findFallbackOrthogonalRoute(startOut, endOut, [startBounds, endBounds]);
  if (!fallbackRoutePoints) {
    return null;
  }

  const allPoints = [start, startOut, ...fallbackRoutePoints.slice(1, -1), endOut, end];
  const segments = buildSegmentsFromRoutePoints(allPoints);
  if (segments.length > 1 || start.r === end.r || start.c === end.c) {
    return segments.length > 0 ? segments : null;
  }

  const forcedElbowRoute = [start, startOut, { r: startOut.r, c: endOut.c }, endOut, end];
  const forcedSegments = buildSegmentsFromRoutePoints(forcedElbowRoute);
  return forcedSegments.length > 0 ? forcedSegments : null;
}

function findFallbackOrthogonalRoute(
  start: Coords,
  end: Coords,
  obstacles: BoundingBox[],
): Coords[] | null {
  if (start.r === end.r || start.c === end.c) {
    return [start, end];
  }

  const directElbows = [
    { r: start.r, c: end.c },
    { r: end.r, c: start.c },
  ];

  for (const elbow of directElbows) {
    if (
      isOrthogonalSegmentClear(start, elbow, obstacles) &&
      isOrthogonalSegmentClear(elbow, end, obstacles)
    ) {
      return [start, elbow, end];
    }
  }

  const topRow = Math.min(...obstacles.map((box) => box.top)) - 1;
  const bottomRow = Math.max(...obstacles.map((box) => box.bottom)) + 1;
  const leftCol = Math.min(...obstacles.map((box) => box.left)) - 1;
  const rightCol = Math.max(...obstacles.map((box) => box.right)) + 1;

  const detours: Coords[][] = [
    [start, { r: topRow, c: start.c }, { r: topRow, c: end.c }, end],
    [start, { r: bottomRow, c: start.c }, { r: bottomRow, c: end.c }, end],
    [start, { r: start.r, c: leftCol }, { r: end.r, c: leftCol }, end],
    [start, { r: start.r, c: rightCol }, { r: end.r, c: rightCol }, end],
  ];

  const clearDetour = detours.find((route) =>
    route.slice(1).every((point, index) => isOrthogonalSegmentClear(route[index]!, point, obstacles))
  );
  if (clearDetour) {
    return clearDetour;
  }

  return [start, directElbows[0]!, end];
}

function buildSegmentsFromRoutePoints(points: Coords[]): Segment[] {
  const normalizedPoints = dedupeConsecutivePoints(points);
  const cornerPoints = compressOrthogonalPoints(normalizedPoints);
  if (cornerPoints.length < 2) {
    return [];
  }

  return cornerPoints
    .slice(1)
    .map((point, index) => createLineSegment(cornerPoints[index], point))
    .filter((segment) => !_.isEqual(segment.start, segment.end));
}

function isOrthogonalSegmentClear(
  start: Coords,
  end: Coords,
  obstacles: BoundingBox[],
): boolean {
  if (start.r !== end.r && start.c !== end.c) {
    return false;
  }

  if (start.r === end.r) {
    const row = start.r;
    const [minCol, maxCol] = [Math.min(start.c, end.c), Math.max(start.c, end.c)];
    for (let col = minCol + 1; col < maxCol; col += 1) {
      if (obstacles.some((box) => row >= box.top && row <= box.bottom && col >= box.left && col <= box.right)) {
        return false;
      }
    }
    return true;
  }

  const col = start.c;
  const [minRow, maxRow] = [Math.min(start.r, end.r), Math.max(start.r, end.r)];
  for (let row = minRow + 1; row < maxRow; row += 1) {
    if (obstacles.some((box) => row >= box.top && row <= box.bottom && col >= box.left && col <= box.right)) {
      return false;
    }
  }
  return true;
}

function dedupeConsecutivePoints(points: Coords[]): Coords[] {
  return points.filter((point, index) => index === 0 || !_.isEqual(point, points[index - 1]));
}

function compressOrthogonalPoints(points: Coords[]): Coords[] {
  if (points.length <= 2) {
    return points;
  }

  const compressed: Coords[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = compressed[compressed.length - 1];
    const curr = points[index];
    const next = points[index + 1];
    const prevAxis = prev.r === curr.r ? "H" : "V";
    const nextAxis = curr.r === next.r ? "H" : "V";
    if (prevAxis !== nextAxis) {
      compressed.push(curr);
    }
  }
  compressed.push(points[points.length - 1]);
  return compressed;
}

function findOrthogonalRoute(
  start: Coords,
  end: Coords,
  obstacles: BoundingBox[],
): Coords[] | null {
  const margin = 4;
  const minRow = Math.min(start.r, end.r, ...obstacles.map((box) => box.top)) - margin;
  const maxRow = Math.max(start.r, end.r, ...obstacles.map((box) => box.bottom)) + margin;
  const minCol = Math.min(start.c, end.c, ...obstacles.map((box) => box.left)) - margin;
  const maxCol = Math.max(start.c, end.c, ...obstacles.map((box) => box.right)) + margin;

  const isBlocked = (coords: Coords) => {
    if (_.isEqual(coords, start) || _.isEqual(coords, end)) {
      return false;
    }
    return obstacles.some(
      (box) =>
        coords.r >= box.top &&
        coords.r <= box.bottom &&
        coords.c >= box.left &&
        coords.c <= box.right,
    );
  };

  const keyOf = (coords: Coords) => `${coords.r}:${coords.c}`;
  const queue: Coords[] = [start];
  const parent = new Map<string, string | null>([[keyOf(start), null]]);
  const visited = new Set<string>([keyOf(start)]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (_.isEqual(current, end)) {
      const path: Coords[] = [];
      let cursorKey: string | null = keyOf(current);
      while (cursorKey) {
        const [r, c] = cursorKey.split(":").map(Number);
        path.push({ r, c });
        cursorKey = parent.get(cursorKey) ?? null;
      }
      return path.reverse();
    }

    const neighbors: Coords[] = [
      { r: current.r - 1, c: current.c },
      { r: current.r + 1, c: current.c },
      { r: current.r, c: current.c - 1 },
      { r: current.r, c: current.c + 1 },
    ];
    neighbors.forEach((neighbor) => {
      if (
        neighbor.r < minRow ||
        neighbor.r > maxRow ||
        neighbor.c < minCol ||
        neighbor.c > maxCol ||
        isBlocked(neighbor)
      ) {
        return;
      }
      const key = keyOf(neighbor);
      if (visited.has(key)) {
        return;
      }
      visited.add(key);
      parent.set(key, keyOf(current));
      queue.push(neighbor);
    });
  }

  return null;
}

function countChars(value: string): number {
  return Array.from(value).length;
}

function getLabelText(labelLines: string[]): string {
  return labelLines.join(" ");
}

export function getMultiSegmentPointHandles(shape: MultiSegment): MultiSegmentPointHandle[] {
  if (shape.closed) {
    return shape.segments.map((segment, pointIndex) => ({
      pointIndex,
      coords: segment.end,
    }));
  }

  return shape.segments.slice(0, -1).map((segment, pointIndex) => ({
    pointIndex,
    coords: segment.end,
  }));
}

export function getMultiSegmentPointHandleAtCoords(
  shape: MultiSegment,
  coords: Coords,
): MultiSegmentPointHandle | null {
  return (
    getMultiSegmentPointHandles(shape).find((handle) => _.isEqual(handle.coords, coords)) ?? null
  );
}

function getPrimarySegment(shape: Line | MultiSegment) {
  if (shape.type === "LINE") {
    return shape;
  }

  return (
    [...shape.segments].sort((left, right) => {
      const leftLength =
        left.axis === "HORIZONTAL"
          ? Math.abs(left.end.c - left.start.c)
          : Math.abs(left.end.r - left.start.r);
      const rightLength =
        right.axis === "HORIZONTAL"
          ? Math.abs(right.end.c - right.start.c)
          : Math.abs(right.end.r - right.start.r);
      return rightLength - leftLength;
    })[0] ?? null
  );
}

export function getLineLabelTextShape(
  shape: Line | MultiSegment,
  style: Pick<Style, "lineTextAlign" | "lineTextPadding">,
): TextShape | null {
  const box = getLineLabelBox(shape, style);
  const labelText = getLabelText(getLineLabelLines(shape));
  if (!box || !labelText) {
    return null;
  }

  const renderText =
    box.isVertical
      ? labelText
      : box.textAlign === "left"
      ? labelText.padEnd(Math.max(countChars(labelText), box.widthCells), " ")
      : box.textAlign === "right"
      ? labelText.padStart(Math.max(countChars(labelText), box.widthCells), " ")
      : (() => {
          const width = Math.max(countChars(labelText), box.widthCells);
          const remaining = Math.max(0, width - countChars(labelText));
          const leftPad = Math.floor(remaining / 2);
          const rightPad = remaining - leftPad;
          return `${" ".repeat(leftPad)}${labelText}${" ".repeat(rightPad)}`;
        })();

  return {
    type: "TEXT",
    start: box.start,
    lines: [renderText],
  };
}

export function getLineLabelBox(
  shape: Line | MultiSegment,
  style: Pick<Style, "lineTextAlign" | "lineTextPadding">,
): {
  start: Coords;
  widthCells: number;
  textAlign: "left" | "center" | "right";
  isVertical: boolean;
} | null {
  const segment = getPrimarySegment(shape);
  if (!segment) return null;

  const padding = Math.max(0, Math.floor(style.lineTextPadding));
  if (segment.axis === "HORIZONTAL") {
    const left = Math.min(segment.start.c, segment.end.c);
    const right = Math.max(segment.start.c, segment.end.c);
    const width = Math.max(1, right - left + 1 - padding * 2);
    const start = { r: segment.start.r, c: left + padding };
    const isForward = segment.direction === "LEFT_TO_RIGHT";
    const textAlign =
      style.lineTextAlign === "CENTER"
        ? "center"
        : style.lineTextAlign === "START"
        ? isForward
          ? "left"
          : "right"
        : isForward
        ? "right"
        : "left";

    return {
      start,
      widthCells: width,
      textAlign,
      isVertical: false,
    };
  }

  const top = Math.min(segment.start.r, segment.end.r);
  const bottom = Math.max(segment.start.r, segment.end.r);
  const available = Math.max(1, bottom - top + 1 - padding * 2);
  const startRow =
    style.lineTextAlign === "START"
      ? (segment.direction === "DOWN" ? top + padding : bottom - padding)
      : style.lineTextAlign === "END"
      ? (segment.direction === "DOWN" ? bottom - padding : top + padding)
      : top + Math.floor((available - 1) / 2) + padding;

  return {
    start: {
      r: startRow,
      c: segment.start.c + 2,
    },
    widthCells: 18,
    textAlign: "left",
    isVertical: true,
  };
}

export function getLineLabelEditorTextShape(
  shape: Line | MultiSegment,
  style: Pick<Style, "lineTextAlign" | "lineTextPadding">,
): TextShape {
  const box = getLineLabelBox(shape, style) ?? {
    start: shape.type === "LINE" ? shape.start : shape.segments[0]?.start ?? { r: 0, c: 0 },
    widthCells: 12,
    textAlign: "left" as const,
    isVertical: false,
  };

  return {
    type: "TEXT",
    start: box.start,
    lines: [getLabelText(getLineLabelLines(shape))],
  };
}

export function mergeLineLabelInput(value: string): string[] {
  const flattened = value.replace(/\r?\n/g, " ");
  return flattened.trim().length > 0 ? [flattened] : [];
}

export function affectsLineBindings(shape: Shape): shape is Extract<Shape, { type: "RECTANGLE" | "TEXT" }> {
  return shape.type === "RECTANGLE" || shape.type === "TEXT";
}

export function isLineBoundToShape(shape: Shape, shapeId: string): boolean {
  if (!isLineLikeShape(shape)) return false;
  return (
    shape.startBinding?.targetShapeId === shapeId ||
    shape.endBinding?.targetShapeId === shapeId
  );
}

export function getBorderSideLabel(side: ShapeBorderSide): string {
  return side.toLowerCase();
}
