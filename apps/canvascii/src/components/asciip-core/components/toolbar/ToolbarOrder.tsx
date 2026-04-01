import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { selectors } from "../../store/selectors";
import { BringToFront, SendToBack } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ToolbarOrder() {
  const interactions = useEditorInteractions();

  const hasSingleSelection = useAppSelector((state) =>
    selectors.hasSingleSelectedShape(state.diagram)
  );

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="push to back"
        title="Push shape to back"
        size="icon"
        variant="ghost"
        disabled={!hasSingleSelection}
        onClick={() => interactions.moveSelectionToBack()}
      >
        <SendToBack />
      </Button>
      <Button
        aria-label="bring to front"
        title="Bring shape to front"
        size="icon"
        variant="ghost"
        disabled={!hasSingleSelection}
        onClick={() => interactions.moveSelectionToFront()}
      >
        <BringToFront />
      </Button>
    </div>
  );
}
