import { MoreHorizontal, Type } from "lucide-react";
import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ToolbarOverflowMenu() {
  const interactions = useEditorInteractions();
  const styleMode = useAppSelector((state) => state.diagram.styleMode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Canvas display options"
            className="h-9 w-9 border border-slate-700 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Type className="h-4 w-4" />
          Character set
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-1">
          <ToggleGroup
            type="single"
            value={styleMode}
            onValueChange={(nextMode) => {
              if (nextMode === "ASCII" || nextMode === "UNICODE") {
                interactions.setStyleMode(nextMode);
              }
            }}
            className="w-full"
            spacing={0}
          >
            <ToggleGroupItem value="ASCII" variant="outline" className="flex-1">
              ASCII
            </ToggleGroupItem>
            <ToggleGroupItem value="UNICODE" variant="outline" className="flex-1">
              Unicode
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
