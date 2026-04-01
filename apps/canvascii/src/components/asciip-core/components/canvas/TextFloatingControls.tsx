import { AlignCenter, AlignLeft, AlignRight, Square } from "lucide-react";
import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { selectors } from "../../store/selectors";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FloatingOrderMenu } from "./FloatingOrderMenu";
import type { ShapeObject } from "../../store/diagramSlice";

export function TextFloatingControls() {
  const interactions = useEditorInteractions();
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const singleTextShape =
    selectedShapeObjs.length === 1 && selectedShapeObjs[0]?.shape.type === "TEXT"
      ? selectedShapeObjs[0]
      : null;

  if (!singleTextShape) {
    return null;
  }

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            aria-label="Align text left"
            onClick={() => interactions.alignSelectedText("LEFT")}
          >
            <AlignLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            aria-label="Align text center"
            onClick={() => interactions.alignSelectedText("CENTER")}
          >
            <AlignCenter className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            aria-label="Align text right"
            onClick={() => interactions.alignSelectedText("RIGHT")}
          >
            <AlignRight className="h-4 w-4" />
          </Button>
        </div>
        <Separator orientation="vertical" className="h-6 bg-slate-800" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-md border border-slate-800 bg-slate-900 px-2 text-[11px] font-medium text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
          onClick={() => interactions.encloseSelectedText()}
        >
          <Square className="mr-1.5 h-3.5 w-3.5" />
          Enclose
        </Button>
        <Separator orientation="vertical" className="h-6 bg-slate-800" />
        <FloatingOrderMenu />
      </div>
    </div>
  );
}
