import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { LINE_STYLE, Style, line_repr, resolveRectangleBorder } from "../../models/style";
import { selectors } from "../../store/selectors";
import _ from "lodash";
import { cn } from "@/lib/utils";

const lineStyleDisplay: Record<
  LINE_STYLE,
  {
    name: string;
    repr: string;
  }
> = {
  ASCII: {
    name: "ASCII",
    repr: `${line_repr.LINE_HORIZONTAL.ASCII}${line_repr.LINE_HORIZONTAL.ASCII}${line_repr.CORNER_TR.ASCII}`,
  },
  LIGHT: {
    name: "Light",
    repr: `${line_repr.LINE_HORIZONTAL.LIGHT}${line_repr.LINE_HORIZONTAL.LIGHT}${line_repr.CORNER_TR.LIGHT}`,
  },
  LIGHT_ROUNDED: {
    name: "Light rounded",
    repr: `${line_repr.LINE_HORIZONTAL.LIGHT_ROUNDED}${line_repr.LINE_HORIZONTAL.LIGHT_ROUNDED}${line_repr.CORNER_TR.LIGHT_ROUNDED}`,
  },
  HEAVY: {
    name: "Heavy",
    repr: `${line_repr.LINE_HORIZONTAL.HEAVY}${line_repr.LINE_HORIZONTAL.HEAVY}${line_repr.CORNER_TR.HEAVY}`,
  },
  DOUBLE: {
    name: "Double",
    repr: `${line_repr.LINE_HORIZONTAL.DOUBLE}${line_repr.LINE_HORIZONTAL.DOUBLE}${line_repr.CORNER_TR.DOUBLE}`,
  },
};

type LineSelectorValue = LINE_STYLE | "NONE" | typeof BLOCK_VALUE;
const MIXED_VALUE = "__MIXED__";
const BLOCK_VALUE = "__BLOCK__";

export function SelectLineStyle({
  compact = false,
}: {
  compact?: boolean;
}) {
  const interactions = useEditorInteractions();

  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const hasRectangleContext = (): boolean =>
    selectedTool === "RECTANGLE" ||
    (selectedTool === "SELECT" &&
      selectedShapeObjs.some((shapeObj) => shapeObj.shape.type === "RECTANGLE"));

  const isLineStyleSelectEnabled = (): boolean => {
    if (styleMode === "ASCII") return false;

    if (
      selectedTool === "RECTANGLE" ||
      selectedTool === "LINE" ||
      selectedTool === "MULTI_SEGMENT_LINE"
    )
      return true;

    if (
      selectedTool === "SELECT" &&
      selectedShapeObjs.length > 0 &&
      selectedShapeObjs.every(
        (shapeObj) =>
          shapeObj.shape.type === "RECTANGLE" ||
          shapeObj.shape.type === "LINE" ||
          shapeObj.shape.type === "MULTI_SEGMENT_LINE"
      )
    )
      return true;

    return false;
  };

  const handleLineStyleChange = (value: string) => {
    const shapeIds: string[] | undefined =
      selectedShapeObjs.length === 0
        ? undefined
        : selectedShapeObjs.map((shapeObj) => shapeObj.id);

    if (hasRectangleContext() && value === "NONE") {
      interactions.setStyle({
        style: { rectangleBorder: "NONE" },
        shapeIds,
      });
      return;
    }

    if (hasRectangleContext() && value === BLOCK_VALUE) {
      interactions.setStyle({
        style: { rectangleBorder: "BLOCK" },
        shapeIds,
      });
      return;
    }

    const lineStyle = value as LINE_STYLE;
    const stylePatch = hasRectangleContext()
      ? { lineStyle, rectangleBorder: "LINE" as const }
      : { lineStyle };

    interactions.setStyle({
      style: stylePatch,
      shapeIds,
    });
  };

  const getValue = (): LineSelectorValue | undefined => {
    if (hasRectangleContext()) {
      if (selectedShapeObjs.length === 0) {
        const border = resolveRectangleBorder(globalStyle);
        return border === "NONE"
          ? "NONE"
          : border === "BLOCK"
            ? BLOCK_VALUE
            : globalStyle.lineStyle;
      }

      const values = selectedShapeObjs.map((shapeObj) => {
        const style: Style = {
          ...globalStyle,
          ...(shapeObj.style ?? {}),
        };
        if (shapeObj.shape.type === "RECTANGLE") {
          const border = resolveRectangleBorder(style);
          if (border === "NONE") return "NONE";
          if (border === "BLOCK") return BLOCK_VALUE;
        }
        return style.lineStyle;
      });

      if (_.uniq(values).length === 1) {
        return values[0] as LineSelectorValue;
      }
      return undefined;
    }

    if (selectedShapeObjs.length === 0) {
      return globalStyle.lineStyle;
    }

    const values = selectedShapeObjs.map(
      (shapeObj) => shapeObj?.style?.lineStyle ?? globalStyle.lineStyle
    );

    if (_.uniq(values).length === 1) {
      return values[0];
    }
    return undefined;
  };

  return (
    <div className="flex items-center gap-2">
      {!compact ? <span className="text-xs text-slate-300">Line</span> : null}
      <select
        value={getValue() ?? MIXED_VALUE}
        onChange={(event) => handleLineStyleChange(event.target.value)}
        disabled={!isLineStyleSelectEnabled()}
        aria-label="Line style"
        className={cn(
          "h-8 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100 outline-hidden focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-[122px]" : "w-[150px]",
        )}
      >
        <option value={MIXED_VALUE} disabled>
          Mixed
        </option>
        {hasRectangleContext() ? <option value="NONE">None</option> : null}
        {hasRectangleContext() ? <option value={BLOCK_VALUE}>Solid edge ▀▐▄</option> : null}
        {Object.keys(lineStyleDisplay).map((value) => (
          <option key={value} value={value}>
            {lineStyleDisplay[value as LINE_STYLE].name} {lineStyleDisplay[value as LINE_STYLE].repr}
          </option>
        ))}
      </select>
    </div>
  );
}
