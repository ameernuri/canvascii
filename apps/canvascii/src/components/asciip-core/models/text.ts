import { CanvasSize } from "../store/diagramSlice";
import { Coords, TextShape } from "./shapes";

export function getStringFromShape(textShape: TextShape): string {
  return textShape.lines.join("\n");
}

export function getLines(text: string): string[] {
  return text.split("\n");
}

export function capText(
  start: Coords,
  lines: string[],
  canvasSize: CanvasSize
): string[] {
  return lines
    .filter((_line, idx) => start.r + idx < canvasSize.rows)
    .map((line) => line.slice(0, canvasSize.cols - start.c));
}

type ListContinuationMatch =
  | {
      kind: "BULLET";
      indent: string;
      marker: "-" | "*";
      spacing: string;
      prefixLength: number;
    }
  | {
      kind: "ORDERED";
      indent: string;
      delimiter: "." | ")";
      spacing: string;
      ordinal: number;
      markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
      markerCase: "LOWER" | "UPPER";
      prefixLength: number;
    }
  | {
      kind: "CHECKBOX";
      indent: string;
      bulletMarker?: "-" | "*";
      bulletSpacing: string;
      spacing: string;
      prefixLength: number;
    };

const BULLET_LIST_RE = /^(\s*)([-*])(\s+)/;
const ORDERED_LIST_RE = /^(\s*)([0-9A-Za-z]+)([.)])(\s+)/;
const CHECKBOX_LIST_RE = /^(\s*)(?:([-*])(\s+))?\[(?: |x|X)?\](\s*)/;
const ROMAN_NUMERAL_RE = /^(?=[ivxlcdm]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function normalizeCheckboxPrefix(line: string): string {
  return line.replace(
    /^(\s*)(?:([-*])(\s+))?\[\](\s*)/,
    (_match, indent: string = "", bulletMarker?: string, bulletSpacing?: string, spacing?: string) =>
      `${indent}${bulletMarker ? `${bulletMarker}${bulletSpacing ?? " "}` : ""}[ ]${spacing?.length ? spacing : " "}`
  );
}

/**
 * Toggle a checklist marker only when the click lands on the `[ ]` / `[x]` glyphs.
 * This keeps normal text clicks behaving like selection while making checkboxes feel interactive.
 */
export function toggleCheckboxAtIndex(
  line: string,
  index: number
): string | null {
  const normalizedLine = normalizeCheckboxPrefix(line);
  const match = normalizedLine.match(CHECKBOX_LIST_RE);
  if (!match) {
    return null;
  }

  const indent = match[1] ?? "";
  const bulletMarker = match[2] ?? "";
  const bulletSpacing = match[3] ?? "";
  const boxStart = indent.length + bulletMarker.length + bulletSpacing.length;
  const boxEnd = boxStart + 2;

  if (index < boxStart || index > boxEnd) {
    return null;
  }

  const marker = normalizedLine[boxStart + 1] === " " ? "x" : " ";
  return `${normalizedLine.slice(0, boxStart + 1)}${marker}${normalizedLine.slice(boxStart + 2)}`;
}

function matchListPrefix(line: string): ListContinuationMatch | null {
  const checkboxMatch = line.match(CHECKBOX_LIST_RE);
  if (checkboxMatch) {
    const indent = checkboxMatch[1] ?? "";
    const bulletMarker = (checkboxMatch[2] as "-" | "*") ?? undefined;
    const bulletSpacing = checkboxMatch[3] ?? " ";
    const spacing = checkboxMatch[4]?.length ? checkboxMatch[4] : " ";
    const prefixLength =
      indent.length +
      (bulletMarker ? bulletMarker.length + bulletSpacing.length : 0) +
      3 +
      (checkboxMatch[4]?.length ?? 0);

    return {
      kind: "CHECKBOX",
      indent,
      bulletMarker,
      bulletSpacing,
      spacing,
      prefixLength,
    };
  }

  const bulletMatch = line.match(BULLET_LIST_RE);
  if (bulletMatch) {
    return {
      kind: "BULLET",
      indent: bulletMatch[1] ?? "",
      marker: (bulletMatch[2] as "-" | "*") ?? "-",
      spacing: bulletMatch[3] ?? " ",
      prefixLength: bulletMatch[0]?.length ?? 0,
    };
  }

  const orderedMatch = line.match(ORDERED_LIST_RE);
  if (orderedMatch) {
    const token = orderedMatch[2] ?? "1";
    const parsedMarker = parseOrderedListMarker(token);
    if (!parsedMarker) {
      return null;
    }
    return {
      kind: "ORDERED",
      indent: orderedMatch[1] ?? "",
      ordinal: parsedMarker.ordinal,
      markerKind: parsedMarker.markerKind,
      markerCase: parsedMarker.markerCase,
      delimiter: (orderedMatch[3] as "." | ")") ?? ".",
      spacing: orderedMatch[4] ?? " ",
      prefixLength: orderedMatch[0]?.length ?? 0,
    };
  }

  return null;
}

function alphaToNumber(token: string): number {
  return Array.from(token.toLowerCase()).reduce((value, char) => {
    return value * 26 + (char.charCodeAt(0) - 96);
  }, 0);
}

function numberToAlpha(value: number, markerCase: "LOWER" | "UPPER"): string {
  let current = Math.max(1, Math.floor(value));
  let output = "";
  while (current > 0) {
    current -= 1;
    output = String.fromCharCode(97 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return markerCase === "UPPER" ? output.toUpperCase() : output;
}

function romanToNumber(token: string): number | null {
  const normalized = token.toLowerCase();
  if (!ROMAN_NUMERAL_RE.test(normalized)) {
    return null;
  }
  const values: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  let total = 0;
  for (let i = 0; i < normalized.length; i++) {
    const current = values[normalized[i]!] ?? 0;
    const next = values[normalized[i + 1] ?? ""] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 ? total : null;
}

function numberToRoman(value: number, markerCase: "LOWER" | "UPPER"): string {
  const pairs: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let current = Math.max(1, Math.floor(value));
  let output = "";
  pairs.forEach(([amount, token]) => {
    while (current >= amount) {
      output += token;
      current -= amount;
    }
  });
  return markerCase === "UPPER" ? output.toUpperCase() : output;
}

function parseOrderedListMarker(token: string): {
  ordinal: number;
  markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
  markerCase: "LOWER" | "UPPER";
} | null {
  if (/^\d+$/.test(token)) {
    return {
      ordinal: parseInt(token, 10),
      markerKind: "NUMERIC",
      markerCase: "LOWER",
    };
  }

  if (!/^[A-Za-z]+$/.test(token)) {
    return null;
  }

  const markerCase = token === token.toUpperCase() ? "UPPER" : "LOWER";
  const romanOrdinal =
    (token.length > 1 || token.toLowerCase() === "i") ? romanToNumber(token) : null;
  if (romanOrdinal != null) {
    return {
      ordinal: romanOrdinal,
      markerKind: "ROMAN",
      markerCase,
    };
  }

  return {
    ordinal: alphaToNumber(token),
    markerKind: "ALPHA",
    markerCase,
  };
}

function formatOrderedListMarker(match: Extract<ListContinuationMatch, { kind: "ORDERED" }>, ordinal: number): string {
  if (match.markerKind === "NUMERIC") {
    return String(ordinal);
  }
  if (match.markerKind === "ROMAN") {
    return numberToRoman(ordinal, match.markerCase);
  }
  return numberToAlpha(ordinal, match.markerCase);
}

type ParsedListLine = {
  raw: string;
  normalized: string;
  match: ListContinuationMatch | null;
  indentWidth: number;
  content: string;
};

function getIndentWidth(indent: string): number {
  return indent.replace(/\t/g, "  ").length;
}

function normalizeIndentWidth(width: number): number {
  return Math.max(0, Math.floor(width / 2) * 2);
}

function formatListLine(
  parsed: ParsedListLine,
  input: { indentWidth: number; orderedOrdinal?: number }
): string {
  if (!parsed.match) {
    return parsed.raw;
  }

  const indent = " ".repeat(normalizeIndentWidth(input.indentWidth));
  if (parsed.match.kind === "BULLET") {
    return `${indent}${parsed.match.marker}${parsed.match.spacing}${parsed.content}`;
  }

  if (parsed.match.kind === "CHECKBOX") {
    const checkboxToken =
      parsed.normalized.includes("[x]") || parsed.normalized.includes("[X]") ? "[x]" : "[ ]";
    return `${indent}${
      parsed.match.bulletMarker
        ? `${parsed.match.bulletMarker}${parsed.match.bulletSpacing}`
        : ""
    }${checkboxToken}${parsed.match.spacing}${parsed.content}`;
  }

  const ordinal = input.orderedOrdinal ?? parsed.match.ordinal;
  return `${indent}${formatOrderedListMarker(parsed.match, ordinal)}${parsed.match.delimiter}${parsed.match.spacing}${parsed.content}`;
}

function parseListLine(line: string): ParsedListLine {
  const normalized = normalizeCheckboxPrefix(line);
  const match = matchListPrefix(normalized);
  return {
    raw: line,
    normalized,
    match,
    indentWidth: match ? getIndentWidth(match.indent) : 0,
    content: match ? normalized.slice(match.prefixLength) : line,
  };
}

function getChildOrderedMarker(
  markerKind: "NUMERIC" | "ALPHA" | "ROMAN",
  markerCase: "LOWER" | "UPPER"
): {
  markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
  markerCase: "LOWER" | "UPPER";
} {
  if (markerKind === "NUMERIC") {
    return { markerKind: "ALPHA", markerCase: "LOWER" };
  }
  if (markerKind === "ALPHA") {
    return { markerKind: "ROMAN", markerCase: "LOWER" };
  }
  return { markerKind: "NUMERIC", markerCase };
}

function renumberOrderedRuns(lines: string[]): string[] {
  const nextLines = [...lines];
  const parsedLines = nextLines.map((line) => parseListLine(line));

  type OutlineNode = {
    index: number;
    indentWidth: number;
    ordered?: {
      markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
      markerCase: "LOWER" | "UPPER";
      delimiter: "." | ")";
    };
    children: OutlineNode[];
  };

  const root: OutlineNode = { index: -1, indentWidth: -2, children: [] };
  let stack: OutlineNode[] = [root];

  for (let i = 0; i < parsedLines.length; i++) {
    const parsed = parsedLines[i];
    if (!parsed?.match) {
      stack = [root];
      continue;
    }

    while (
      stack.length > 1 &&
      stack[stack.length - 1]!.indentWidth >= parsed.indentWidth
    ) {
      stack.pop();
    }

    const node: OutlineNode = {
      index: i,
      indentWidth: parsed.indentWidth,
      ordered:
        parsed.match.kind === "ORDERED"
          ? {
              markerKind: parsed.match.markerKind,
              markerCase: parsed.match.markerCase,
              delimiter: parsed.match.delimiter,
            }
          : undefined,
      children: [],
    };

    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }

  const applyOrderedNumbering = (
    nodes: OutlineNode[],
    parentOrdered?: {
      markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
      markerCase: "LOWER" | "UPPER";
    }
  ) => {
    let currentRun:
      | {
          markerKind: "NUMERIC" | "ALPHA" | "ROMAN";
          markerCase: "LOWER" | "UPPER";
          delimiter: "." | ")";
          nextOrdinal: number;
        }
      | null = null;

    nodes.forEach((node) => {
      const parsed = parsedLines[node.index];
      if (!parsed?.match) {
        currentRun = null;
        return;
      }

      if (parsed.match.kind !== "ORDERED") {
        currentRun = null;
        applyOrderedNumbering(node.children, parentOrdered);
        return;
      }

      const preferredMarker = currentRun
        ? {
            markerKind: currentRun.markerKind,
            markerCase: currentRun.markerCase,
          }
        : parentOrdered
        ? getChildOrderedMarker(parentOrdered.markerKind, parentOrdered.markerCase)
        : {
            markerKind: parsed.match.markerKind,
            markerCase: parsed.match.markerCase,
          };

      if (
        !currentRun ||
        currentRun.markerKind !== preferredMarker.markerKind ||
        currentRun.markerCase !== preferredMarker.markerCase ||
        currentRun.delimiter !== parsed.match.delimiter
      ) {
        currentRun = {
          markerKind: preferredMarker.markerKind,
          markerCase: preferredMarker.markerCase,
          delimiter: parsed.match.delimiter,
          nextOrdinal: 1,
        };
      }

      const adjustedParsed: ParsedListLine = {
        ...parsed,
        match: {
          ...parsed.match,
          markerKind: currentRun.markerKind,
          markerCase: currentRun.markerCase,
        },
      };

      nextLines[node.index] = formatListLine(adjustedParsed, {
        indentWidth: parsed.indentWidth,
        orderedOrdinal: currentRun.nextOrdinal,
      });
      parsedLines[node.index] = parseListLine(nextLines[node.index]!);

      currentRun.nextOrdinal += 1;
      applyOrderedNumbering(node.children, {
        markerKind: currentRun.markerKind,
        markerCase: currentRun.markerCase,
      });
    });
  };

  applyOrderedNumbering(root.children);
  return nextLines;
}

function findLineIndexAtOffset(value: string, offset: number): number {
  return value.slice(0, Math.max(0, Math.min(offset, value.length))).split("\n").length - 1;
}

function getLineOffsets(lines: string[], lineIndex: number): { start: number; end: number } {
  let start = 0;
  for (let i = 0; i < lineIndex; i++) {
    start += (lines[i] ?? "").length + 1;
  }
  const end = start + (lines[lineIndex] ?? "").length;
  return { start, end };
}

function findPreviousSiblingIndex(lines: string[], lineIndex: number, indentWidth: number): number {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const parsed = parseListLine(lines[i] ?? "");
    if (!parsed.match) {
      continue;
    }
    if (parsed.indentWidth < indentWidth) {
      return -1;
    }
    if (parsed.indentWidth === indentWidth) {
      return i;
    }
  }
  return -1;
}

function hasContent(parsed: ParsedListLine): boolean {
  return parsed.content.trim().length > 0;
}

function collectSubtreeRange(lines: string[], lineIndex: number): { start: number; end: number } {
  const root = parseListLine(lines[lineIndex] ?? "");
  if (!root.match) {
    return { start: lineIndex, end: lineIndex };
  }

  let end = lineIndex;
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const parsed = parseListLine(lines[i] ?? "");
    if (!parsed.match) {
      break;
    }
    if (parsed.indentWidth <= root.indentWidth) {
      break;
    }
    end = i;
  }

  return { start: lineIndex, end };
}

function transformListSubtree(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: 1 | -1
): {
  value: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
  handled: boolean;
} {
  if (selectionStart !== selectionEnd) {
    return {
      value,
      nextSelectionStart: selectionStart,
      nextSelectionEnd: selectionEnd,
      handled: false,
    };
  }

  const lines = value.split("\n");
  const lineIndex = findLineIndexAtOffset(value, selectionStart);
  const parsed = parseListLine(lines[lineIndex] ?? "");

  if (!parsed.match) {
    return {
      value,
      nextSelectionStart: selectionStart,
      nextSelectionEnd: selectionEnd,
      handled: false,
    };
  }

  const subtree = collectSubtreeRange(lines, lineIndex);

  if (direction === -1 && parsed.indentWidth === 0) {
    return {
      value,
      nextSelectionStart: selectionStart,
      nextSelectionEnd: selectionEnd,
      handled: true,
    };
  }

  if (direction === 1) {
    const hasPreviousSibling =
      findPreviousSiblingIndex(lines, lineIndex, parsed.indentWidth) !== -1;
    const hasChildren = subtree.end > subtree.start;

    if (!hasPreviousSibling && (parsed.indentWidth > 0 || hasChildren || !hasContent(parsed))) {
      return {
        value,
        nextSelectionStart: selectionStart,
        nextSelectionEnd: selectionEnd,
        handled: true,
      };
    }
  }

  const sourceOffsets = getLineOffsets(lines, lineIndex);
  const caretColumn = selectionStart - sourceOffsets.start;

  for (let i = subtree.start; i <= subtree.end; i++) {
    const entry = parseListLine(lines[i] ?? "");
    if (!entry.match) continue;
    lines[i] = formatListLine(entry, {
      indentWidth: entry.indentWidth + direction * 2,
    });
  }

  const nextLines = renumberOrderedRuns(lines);
  const nextOffsets = getLineOffsets(nextLines, lineIndex);
  const nextLineLength = (nextLines[lineIndex] ?? "").length;
  const nextSelectionStart = Math.min(nextOffsets.start + caretColumn + direction * 2, nextOffsets.start + nextLineLength);

  return {
    value: nextLines.join("\n"),
    nextSelectionStart: Math.max(nextOffsets.start, nextSelectionStart),
    nextSelectionEnd: Math.max(nextOffsets.start, nextSelectionStart),
    handled: true,
  };
}

export function applyListContinuationOnEnter(
  value: string,
  selectionStart: number,
  selectionEnd: number
): { value: string; nextSelectionStart: number; handled: boolean } {
  const safeSelectionStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeSelectionEnd = Math.max(
    safeSelectionStart,
    Math.min(selectionEnd, value.length)
  );

  const lineStart = value.lastIndexOf("\n", Math.max(0, safeSelectionStart - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", safeSelectionEnd);
  let lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const currentLine = value.slice(lineStart, lineEnd);
  const normalizedCurrentLine = normalizeCheckboxPrefix(currentLine);
  let workingValue = value;
  let workingSelectionStart = safeSelectionStart;
  let workingSelectionEnd = safeSelectionEnd;

  if (normalizedCurrentLine !== currentLine) {
    const delta = normalizedCurrentLine.length - currentLine.length;
    workingValue = `${value.slice(0, lineStart)}${normalizedCurrentLine}${value.slice(lineEnd)}`;
    lineEnd += delta;
    if (workingSelectionStart > lineStart) {
      workingSelectionStart += delta;
    }
    if (workingSelectionEnd > lineStart) {
      workingSelectionEnd += delta;
    }
  }

  const listMatch = matchListPrefix(normalizedCurrentLine);
  if (!listMatch) {
    return {
      value: workingValue,
      nextSelectionStart: workingSelectionStart,
      handled: false,
    };
  }

  const currentLineContent = normalizedCurrentLine
    .slice(listMatch.prefixLength)
    .trim();
  if (currentLineContent.length === 0) {
    const currentIndentWidth = getIndentWidth(listMatch.indent);
    if (currentIndentWidth > 0) {
      const steppedOutLine = formatListLine(parseListLine(normalizedCurrentLine), {
        indentWidth: currentIndentWidth - 2,
        orderedOrdinal: listMatch.kind === "ORDERED" ? 1 : undefined,
      });
      const lineIdx = Math.max(
        0,
        workingValue.slice(0, lineStart).split("\n").length - 1
      );
      const nextLines = workingValue.split("\n");
      nextLines[lineIdx] = steppedOutLine;
      const renumbered = renumberOrderedRuns(nextLines);
      const nextOffsets = getLineOffsets(renumbered, lineIdx);
      return {
        value: renumbered.join("\n"),
        nextSelectionStart: nextOffsets.start + steppedOutLine.length,
        handled: true,
      };
    }

    const removalEnd =
      lineEndIdx === -1 ? lineEnd : Math.min(workingValue.length, lineEnd + 1);
    let nextValue = `${workingValue.slice(0, lineStart)}${workingValue.slice(removalEnd)}`;
    nextValue = renumberOrderedRuns(nextValue.split("\n")).join("\n");

    return {
      value: nextValue,
      nextSelectionStart: lineStart,
      handled: true,
    };
  }

  const before = workingValue.slice(0, workingSelectionStart);
  const after = workingValue.slice(workingSelectionEnd);

  const continuationPrefix =
    listMatch.kind === "BULLET"
      ? `${listMatch.indent}${listMatch.marker}${listMatch.spacing}`
      : listMatch.kind === "CHECKBOX"
      ? `${listMatch.indent}${
          listMatch.bulletMarker
            ? `${listMatch.bulletMarker}${listMatch.bulletSpacing}`
            : ""
        }[ ]${listMatch.spacing}`
      : `${listMatch.indent}${formatOrderedListMarker(listMatch, listMatch.ordinal + 1)}${listMatch.delimiter}${listMatch.spacing}`;

  let nextValue = `${before}\n${continuationPrefix}${after}`;
  const nextSelectionStart = before.length + 1 + continuationPrefix.length;

  if (listMatch.kind === "ORDERED") {
    const insertedLineIdx = before.split("\n").length;
    const nextLines = nextValue.split("\n");
    nextLines[insertedLineIdx] = `${listMatch.indent}${formatOrderedListMarker(listMatch, listMatch.ordinal + 1)}${listMatch.delimiter}${listMatch.spacing}`;
    nextValue = renumberOrderedRuns(nextLines).join("\n");
  }

  return {
    value: nextValue,
    nextSelectionStart,
    handled: true,
  };
}

function getLeadingIndentLength(line: string): number {
  if (line.startsWith("\t")) {
    return 1;
  }
  let spaces = 0;
  while (spaces < 2 && line[spaces] === " ") {
    spaces++;
  }
  return spaces;
}

export function applyIndentationOnTab(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  { outdent = false }: { outdent?: boolean } = {}
): {
  value: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
  handled: boolean;
} {
  const safeSelectionStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeSelectionEnd = Math.max(
    safeSelectionStart,
    Math.min(selectionEnd, value.length)
  );

  const listTransform = transformListSubtree(
    value,
    safeSelectionStart,
    safeSelectionEnd,
    outdent ? -1 : 1
  );
  if (listTransform.handled) {
    return listTransform;
  }

  if (safeSelectionStart === safeSelectionEnd && !outdent) {
    const nextValue = `${value.slice(0, safeSelectionStart)}  ${value.slice(safeSelectionEnd)}`;
    const nextSelectionStart = safeSelectionStart + 2;
    return {
      value: nextValue,
      nextSelectionStart,
      nextSelectionEnd: nextSelectionStart,
      handled: true,
    };
  }

  const lineStart = value.lastIndexOf("\n", Math.max(0, safeSelectionStart - 1)) + 1;
  const effectiveEnd =
    safeSelectionEnd > safeSelectionStart && value[safeSelectionEnd - 1] === "\n"
      ? safeSelectionEnd - 1
      : safeSelectionEnd;
  const lineEndIdx = value.indexOf("\n", effectiveEnd);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const selectedBlock = value.slice(lineStart, lineEnd);
  const selectedLines = selectedBlock.split("\n");

  if (!outdent) {
    const nextBlock = selectedLines.map((line) => `  ${line}`).join("\n");
    const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
    return {
      value: nextValue,
      nextSelectionStart: safeSelectionStart + 2,
      nextSelectionEnd: safeSelectionEnd + selectedLines.length * 2,
      handled: true,
    };
  }

  if (safeSelectionStart === safeSelectionEnd) {
    const currentLine = value.slice(lineStart, lineEnd);
    const removableIndent = Math.min(
      getLeadingIndentLength(currentLine),
      safeSelectionStart - lineStart
    );
    if (removableIndent === 0) {
      return {
        value,
        nextSelectionStart: safeSelectionStart,
        nextSelectionEnd: safeSelectionEnd,
        handled: true,
      };
    }

    const nextValue = `${value.slice(0, lineStart)}${currentLine.slice(removableIndent)}${value.slice(lineEnd)}`;
    return {
      value: nextValue,
      nextSelectionStart: safeSelectionStart - removableIndent,
      nextSelectionEnd: safeSelectionEnd - removableIndent,
      handled: true,
    };
  }

  const removedByLine = selectedLines.map((line) => ({
    removed: getLeadingIndentLength(line),
    value: line.slice(getLeadingIndentLength(line)),
  }));
  const nextBlock = removedByLine
    .map((entry) => entry.value)
    .join("\n");
  const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
  const totalRemoved = removedByLine.reduce((sum, entry) => sum + entry.removed, 0);
  const firstLineRemoved = removedByLine[0]?.removed ?? 0;

  return {
    value: nextValue,
    nextSelectionStart: safeSelectionStart - Math.min(firstLineRemoved, safeSelectionStart - lineStart),
    nextSelectionEnd: safeSelectionEnd - totalRemoved,
    handled: true,
  };
}
