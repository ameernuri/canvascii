import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { Style } from "../../models/style";
import { selectors } from "../../store/selectors";
import _ from "lodash";
import { cn } from "@/lib/utils";

type ArrowHeadValue = "NONE" | "END" | "START" | "START_END";
const MIXED_VALUE = "__MIXED__";

export function SelectArrowHead({
  compact = false,
}: {
  compact?: boolean;
}) {
  const interactions = useEditorInteractions();

  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const isArrowHeadSelectEnabled = (): boolean => {
    if (selectedTool === "LINE" || selectedTool === "MULTI_SEGMENT_LINE")
      return true;

    if (
      selectedTool === "SELECT" &&
      selectedShapeObjs.length > 0 &&
      selectedShapeObjs.every(
        (s) => s.shape.type === "LINE" || s.shape.type === "MULTI_SEGMENT_LINE"
      )
    )
      return true;

    return false;
  };

  const handleArrowHeadStyleChange = (value: string) => {
    const shapeIds: string[] | undefined =
      selectedShapeObjs.length === 0
        ? undefined
        : selectedShapeObjs.map((shapeObj) => shapeObj.id);

    const resolved =
      value === "START_END"
        ? { arrowStartHead: true, arrowEndHead: true }
        : value === "START"
        ? { arrowStartHead: true, arrowEndHead: false }
        : value === "END"
        ? { arrowStartHead: false, arrowEndHead: true }
        : { arrowStartHead: false, arrowEndHead: false };

    interactions.setStyle({
      style: resolved,
      shapeIds,
    });
  };

  const getArrowHeadSelectValue = (style: Partial<Style>): ArrowHeadValue => {
    if (style.arrowEndHead && style.arrowStartHead) return "START_END";
    if (style.arrowEndHead && !style.arrowStartHead) return "END";
    if (!style.arrowEndHead && style.arrowStartHead) return "START";
    return "NONE";
  };

  const getValue = (): ArrowHeadValue | undefined => {
    if (selectedShapeObjs.length === 0) {
      return getArrowHeadSelectValue(globalStyle);
    }

    const values = selectedShapeObjs.map((shapeObj) =>
      shapeObj.style?.arrowStartHead !== undefined &&
      shapeObj.style?.arrowEndHead !== undefined
        ? getArrowHeadSelectValue(shapeObj.style)
        : getArrowHeadSelectValue(globalStyle)
    );

    if (_.uniq(values).length === 1) {
      return values[0];
    }
    return undefined;
  };

  return (
    <div className="flex items-center gap-2">
      {!compact ? <span className="text-xs text-slate-300">Arrow</span> : null}
      <select
        value={getValue() ?? MIXED_VALUE}
        onChange={(event) => handleArrowHeadStyleChange(event.target.value)}
        disabled={!isArrowHeadSelectEnabled()}
        aria-label="Arrow heads"
        className={cn(
          "h-8 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100 outline-hidden focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-[112px]" : "w-[120px]",
        )}
      >
        <option value={MIXED_VALUE} disabled>
          Mixed
        </option>
        <option value="NONE">None ‒ ― ‒</option>
        <option value="END">End ‒ ― ▶</option>
        <option value="START">Start ◀ ― ‒</option>
        <option value="START_END">Both ◀ ― ▶</option>
      </select>
    </div>
  );
}
