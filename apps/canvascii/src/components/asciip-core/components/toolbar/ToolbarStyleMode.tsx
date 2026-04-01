import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { StyleMode } from "../../models/style";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ToolbarStyleMode() {
  const interactions = useEditorInteractions();

  const styleMode = useAppSelector((state) => state.diagram.styleMode);

  const handleStyleModeChange = (newStyleMode: string) => {
    if (newStyleMode != null && newStyleMode !== styleMode) {
      interactions.setStyleMode(newStyleMode as StyleMode);
    }
  };

  return (
    <ToggleGroup
      type="single"
      value={styleMode}
      onValueChange={handleStyleModeChange}
      className="gap-1"
    >
      <ToggleGroupItem
        value="ASCII"
        aria-label="ASCII"
        title="ASCII mode: safer monospaced rendering"
        variant="outline"
      >
        ASCII
      </ToggleGroupItem>
      <ToggleGroupItem
        value="UNICODE"
        aria-label="Unicode"
        title="Unicode mode: richer styling"
        variant="outline"
      >
        Unicode
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
