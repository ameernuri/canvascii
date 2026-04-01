import { useEditorInteractions } from "../../store/hooks";
import { Expand, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FooterCanvasSize() {
  const interactions = useEditorInteractions();

  return (
    <div className="flex items-center gap-1">
      <Button
        aria-label="expand canvas"
        title="Expand canvas"
        size="icon"
        variant="ghost"
        onClick={() => interactions.expandCanvas()}
      >
        <Expand />
      </Button>
      <Button
        aria-label="Shrink canvas to fit"
        title="Shrink canvas to fit"
        size="icon"
        variant="ghost"
        onClick={() => interactions.shrinkCanvasToFit()}
      >
        <Minimize2 />
      </Button>
    </div>
  );
}
