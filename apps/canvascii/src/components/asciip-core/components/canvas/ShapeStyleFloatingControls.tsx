import { useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { selectors } from "../../store/selectors";
import { SelectArrowHead } from "../toolbar/SelectArrowHead";
import { SelectArrowHeadStyle } from "../toolbar/SelectArrowHeadStyle";
import { SelectLineStyle } from "../toolbar/SelectLineStyle";
import { SelectRectangleFill } from "../toolbar/SelectRectangleFill";
import { Separator } from "@/components/ui/separator";

export function ShapeStyleFloatingControls() {
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const selectedShapeObjs = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const context = useMemo(() => {
    const selectionTypes = new Set(selectedShapeObjs.map((shapeObj) => shapeObj.shape.type));

    const lineContext =
      selectedTool === "LINE" ||
      selectedTool === "MULTI_SEGMENT_LINE" ||
      (
        selectedTool === "SELECT" &&
        selectedShapeObjs.length > 0 &&
        Array.from(selectionTypes).every(
          (type) => type === "LINE" || type === "MULTI_SEGMENT_LINE"
        )
      );

    const rectangleContext =
      selectedTool === "RECTANGLE" ||
      (
        selectedTool === "SELECT" &&
        selectedShapeObjs.length > 0 &&
        Array.from(selectionTypes).every((type) => type === "RECTANGLE")
      );

    const lineStyleContext =
      selectedTool === "RECTANGLE" ||
      selectedTool === "LINE" ||
      selectedTool === "MULTI_SEGMENT_LINE" ||
      (
        selectedTool === "SELECT" &&
        selectedShapeObjs.length > 0 &&
        Array.from(selectionTypes).every(
          (type) =>
            type === "RECTANGLE" || type === "LINE" || type === "MULTI_SEGMENT_LINE"
        )
      );

    return {
      lineContext,
      rectangleContext,
      lineStyleContext,
    };
  }, [selectedShapeObjs, selectedTool]);

  if (!context.lineContext && !context.rectangleContext && !context.lineStyleContext) {
    return null;
  }

  return (
    <div className="pointer-events-auto rounded-xl border border-slate-800/90 bg-slate-950/95 px-2 py-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.34)] backdrop-blur">
      <div className="flex items-center gap-2">
        {context.lineStyleContext ? <SelectLineStyle compact /> : null}
        {context.lineContext ? (
          <>
            {context.lineStyleContext ? (
              <Separator orientation="vertical" className="h-6 bg-slate-800" />
            ) : null}
            <SelectArrowHead compact />
            {styleMode === "UNICODE" ? <SelectArrowHeadStyle compact /> : null}
          </>
        ) : null}
        {context.rectangleContext ? (
          <>
            {context.lineStyleContext || context.lineContext ? (
              <Separator orientation="vertical" className="h-6 bg-slate-800" />
            ) : null}
            <SelectRectangleFill compact />
          </>
        ) : null}
      </div>
    </div>
  );
}
