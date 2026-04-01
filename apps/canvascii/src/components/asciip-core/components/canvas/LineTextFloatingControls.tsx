import { Minus, Plus } from "lucide-react";
import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { selectors } from "../../store/selectors";
import { Style, type LINE_TEXT_ALIGN } from "../../models/style";
import { isLineLikeShape } from "../../models/lineFeatures";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import _ from "lodash";
import { FloatingOrderMenu } from "./FloatingOrderMenu";

const ALIGN_OPTIONS: Array<{ value: LINE_TEXT_ALIGN; label: string; preview: string }> = [
  { value: "START", label: "Align text to line start", preview: "⋯—" },
  { value: "CENTER", label: "Align text to line center", preview: "—⋯—" },
  { value: "END", label: "Align text to line end", preview: "—⋯" },
];

export function LineTextFloatingControls() {
  const interactions = useEditorInteractions();
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const lineShapeObjs = selectedShapeObjs.filter((shapeObj) =>
    isLineLikeShape(shapeObj.shape)
  );
  const shouldShow =
    selectedTool === "LINE" ||
    selectedTool === "MULTI_SEGMENT_LINE" ||
    lineShapeObjs.length > 0;

  const shapeIds: string[] | undefined =
    lineShapeObjs.length > 0 ? lineShapeObjs.map((shapeObj) => shapeObj.id) : undefined;

  const resolveStyleValue = <T extends keyof Style>(key: T): Style[T] | undefined => {
    if (lineShapeObjs.length === 0) {
      return globalStyle[key];
    }
    const values = lineShapeObjs.map(
      (shapeObj) => (shapeObj.style?.[key] ?? globalStyle[key]) as Style[T]
    );
    const unique = _.uniq(values);
    return unique.length === 1 ? unique[0] : undefined;
  };

  const align = resolveStyleValue("lineTextAlign") as LINE_TEXT_ALIGN | undefined;
  const padding = resolveStyleValue("lineTextPadding");
  const basePadding = Math.max(
    0,
    Math.floor(
      Number.isFinite(Number(padding))
        ? Number(padding)
        : Number(globalStyle.lineTextPadding ?? 1)
    )
  );

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1">
          {ALIGN_OPTIONS.map((option) => {
            const isActive = option.value === align;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                className={cn(
                  "flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold tracking-[0.12em] transition-colors",
                  isActive
                    ? "border-sky-400 bg-sky-500/12 text-sky-100"
                    : "border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:text-white"
                )}
                onClick={() =>
                  interactions.setStyle({
                    style: { lineTextAlign: option.value },
                    shapeIds,
                  })
                }
              >
                {option.preview}
              </button>
            );
          })}
        </div>
        <Separator orientation="vertical" className="h-6 bg-slate-800" />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Decrease line text padding"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            onClick={() =>
              interactions.setStyle({
                style: { lineTextPadding: Math.max(0, basePadding - 1) },
                shapeIds,
              })
            }
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="min-w-5 text-center text-xs font-semibold text-slate-200">
            {padding == null ? "—" : String(basePadding)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Increase line text padding"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            onClick={() =>
              interactions.setStyle({
                style: { lineTextPadding: Math.min(12, basePadding + 1) },
                shapeIds,
              })
            }
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Separator orientation="vertical" className="h-6 bg-slate-800" />
        <FloatingOrderMenu />
      </div>
    </div>
  );
}
