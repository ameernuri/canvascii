import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function FooterHistory() {
  const interactions = useEditorInteractions();

  const canUndo = useAppSelector((state) => state.diagram.historyIdx > 0);
  const canRedo = useAppSelector(
    (state) => state.diagram.historyIdx < state.diagram.history.length - 1
  );

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Undo"
                size="icon"
                variant="ghost"
                disabled={!canUndo}
                onClick={() => interactions.moveInHistory("UNDO")}
              >
                <Undo2 />
              </Button>
            }
          />
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Redo"
                size="icon"
                variant="ghost"
                disabled={!canRedo}
                onClick={() => interactions.moveInHistory("REDO")}
              >
                <Redo2 />
              </Button>
            }
          />
          <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
