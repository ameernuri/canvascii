import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { RECTANGLE_FILL } from "../../models/style";
import { selectors } from "../../store/selectors";
import _ from "lodash";
import { cn } from "@/lib/utils";
const MIXED_VALUE = "__MIXED__";

export function SelectRectangleFill({
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

  const isRectangleFillSelectEnabled = (): boolean => {
    if (selectedTool === "RECTANGLE") return true;

    if (
      selectedTool === "SELECT" &&
      selectedShapeObjs.length > 0 &&
      selectedShapeObjs.every((s) => s.shape.type === "RECTANGLE")
    ) {
      return true;
    }

    return false;
  };

  const handleRectangleFillChange = (value: string) => {
    const shapeIds: string[] | undefined =
      selectedShapeObjs.length === 0
        ? undefined
        : selectedShapeObjs.map((shapeObj) => shapeObj.id);

    interactions.setStyle({
      style:
        value === "SOLID"
          ? { rectangleFill: "SOLID", rectangleBorder: "BLOCK" }
          : { rectangleFill: value as RECTANGLE_FILL },
      shapeIds,
    });
  };

  const getValue = (): RECTANGLE_FILL | undefined => {
    if (selectedShapeObjs.length === 0) {
      return globalStyle.rectangleFill;
    }

    const values = selectedShapeObjs.map(
      (shapeObj) => shapeObj?.style?.rectangleFill ?? globalStyle.rectangleFill
    );

    if (_.uniq(values).length === 1) {
      return values[0];
    }
    return undefined;
  };

  return (
    <div className="flex items-center gap-2">
      {!compact ? <span className="text-xs text-slate-300">Fill</span> : null}
      <select
        value={getValue() ?? MIXED_VALUE}
        onChange={(event) => handleRectangleFillChange(event.target.value)}
        disabled={!isRectangleFillSelectEnabled()}
        aria-label="Rectangle fill"
        className={cn(
          "h-8 rounded-md border border-slate-800 bg-slate-950 px-2 text-sm text-slate-100 outline-hidden focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "w-[92px]" : "w-[110px]",
        )}
      >
        <option value={MIXED_VALUE} disabled>
          Mixed
        </option>
        <option value="NONE">None</option>
        <option value="SOLID">Solid</option>
      </select>
    </div>
  );
}
