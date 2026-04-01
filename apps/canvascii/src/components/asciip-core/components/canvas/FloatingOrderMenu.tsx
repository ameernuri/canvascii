import { BringToFront, MoreHorizontal, SendToBack } from "lucide-react";
import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { selectors } from "../../store/selectors";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function FloatingOrderMenu() {
  const interactions = useEditorInteractions();
  const hasSingleSelection = useAppSelector((state) =>
    selectors.hasSingleSelectedShape(state.diagram)
  );
  const selectedIds = useAppSelector((state) =>
    selectors.selectedShapeIds(state.diagram)
  );
  const hasMultiSelection = selectedIds.length > 1;
  const hasGroupedSelection = useAppSelector((state) =>
    selectedIds.some((shapeId) =>
      state.diagram.groups.some((group) => group.shapeIds.includes(shapeId))
    )
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          disabled={!hasMultiSelection}
          onSelect={() => interactions.groupSelection()}
        >
          <span>Group selection</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasGroupedSelection}
          onSelect={() => interactions.ungroupSelection()}
        >
          <span>Ungroup</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSingleSelection}
          onSelect={() => interactions.moveSelectionToFront()}
        >
          <BringToFront className="mr-2 h-4 w-4" />
          Bring to front
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!hasSingleSelection}
          onSelect={() => interactions.moveSelectionToBack()}
        >
          <SendToBack className="mr-2 h-4 w-4" />
          Send to back
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
