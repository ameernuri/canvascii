import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { ARROW_STYLE, arrow_repr } from "../../models/style";
import { selectors } from "../../store/selectors";
import _ from "lodash";
import { cn } from "@/lib/utils";

const arrowHeadStyleDisplay: Record<
  ARROW_STYLE,
  {
    name: string;
    repr: string;
  }
> = {
  ASCII: {
    name: "ASCII",
    repr: arrow_repr.ARROW_RIGHT.ASCII,
  },
  FILLED: {
    name: "Filled",
    repr: arrow_repr.ARROW_RIGHT.FILLED,
  },
  OUTLINED: {
    name: "Outlined",
    repr: arrow_repr.ARROW_RIGHT.OUTLINED,
  },
};

export function SelectArrowHeadStyle({
  compact = false,
}: {
  compact?: boolean;
}) {
  const MIXED_VALUE = "__MIXED__";
  const interactions = useEditorInteractions();

  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const isArrowStyleSelectEnabled = (): boolean => {
    if (styleMode === "ASCII") return false;

    if (selectedTool === "LINE" || selectedTool === "MULTI_SEGMENT_LINE")
      return true;

    if (
      selectedTool === "SELECT" &&
      selectedShapeObjs.length > 0 &&
      selectedShapeObjs.every(
        (shapeObj) =>
          shapeObj.shape.type === "LINE" ||
          shapeObj.shape.type === "MULTI_SEGMENT_LINE"
      )
    )
      return true;

    return false;
  };

  const handleArrowStyleChange = (value: string) => {
    const shapeIds: string[] | undefined =
      selectedShapeObjs.length === 0
        ? undefined
        : selectedShapeObjs.map((shapeObj) => shapeObj.id);

    interactions.setStyle({
      style: { arrowStyle: value as ARROW_STYLE },
      shapeIds,
    });
  };

  const getValue = (): ARROW_STYLE | undefined => {
    if (selectedShapeObjs.length === 0) {
      return globalStyle.arrowStyle;
    }

    const values = selectedShapeObjs.map(
      (shapeObj) => shapeObj?.style?.arrowStyle ?? globalStyle.arrowStyle
    );

    if (_.uniq(values).length === 1) {
      return values[0];
    }
    return undefined;
  };

  return (
    <div className="flex items-center gap-2">
      {!compact ? <span className="text-xs text-slate-300">Head</span> : null}
      <select
        value={getValue() ?? MIXED_VALUE}
        onChange={(event) => handleArrowStyleChange(event.target.value)}
        disabled={!isArrowStyleSelectEnabled()}
        aria-label="Arrow head style"
        className={cn(
          "h-8 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100 outline-hidden focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-[114px]" : "w-[130px]",
        )}
      >
        <option value={MIXED_VALUE} disabled>
          Mixed
        </option>
        {Object.keys(arrowHeadStyleDisplay).map((value) => (
          <option key={value} value={value}>
            {arrowHeadStyleDisplay[value as ARROW_STYLE].name} {arrowHeadStyleDisplay[value as ARROW_STYLE].repr}
          </option>
        ))}
      </select>
    </div>
  );
}
