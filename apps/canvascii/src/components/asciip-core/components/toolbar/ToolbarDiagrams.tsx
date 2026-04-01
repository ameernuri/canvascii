import { Button } from "@/components/ui/button";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { appActions } from "../../store/appSlice";
import { createUniqueCanvasName } from "@canvascii/agent-client/canvas-names";

export function ToolbarDiagrams() {
  const dispatch = useAppDispatch();
  const diagrams = useAppSelector((state) => state.app.diagrams);

  const handleCreateDiagram = () => {
    const nextName = createUniqueCanvasName(diagrams.map((diagram) => diagram.name));
    dispatch(appActions.createDiagram(nextName));
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 border-white/10 bg-white/4 text-slate-100 hover:bg-slate-800 hover:text-slate-100"
      onClick={handleCreateDiagram}
    >
      New Diagram
    </Button>
  );
}
