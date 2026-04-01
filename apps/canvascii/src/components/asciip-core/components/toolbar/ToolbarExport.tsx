import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ExportDialog } from "../dialogs/ExportDialog";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { selectors } from "../../store/selectors";
import { getTextExport } from "../../models/representation";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ToolbarExport() {
  const interactions = useEditorInteractions();

  const shapesCount = useAppSelector((state) => state.diagram.shapes.length);
  const shapeObjs = useAppSelector((state) => state.diagram.shapes);
  const styleMode = useAppSelector((state) => state.diagram.styleMode);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedShapeObjs = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );
  const selectedCount = selectedShapeObjs.length;

  const exportInProgress = useAppSelector(
    (state) => state.diagram.exportInProgress
  );

  const copySelectionAsText = async () => {
    if (selectedCount === 0) return;
    const selectedIdSet = new Set(selectedShapeObjs.map((shapeObj) => shapeObj.id));
    const selectedShapes = shapeObjs.filter((shapeObj) =>
      selectedIdSet.has(shapeObj.id)
    );
    if (selectedShapes.length === 0) return;

    const selectionText = getTextExport(
      selectedShapes,
      { styleMode, globalStyle },
      "NONE"
    );
    await navigator.clipboard.writeText(selectionText);
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={() => void copySelectionAsText()}
                aria-label="Copy selection as text"
                disabled={selectedCount === 0}
                size="icon"
                variant="ghost"
              >
                <Copy />
              </Button>
            }
          />
          <TooltipContent>Copy selection as text (Cmd/Ctrl+Shift+C)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={() => interactions.openExport()}
                aria-label="Export diagram"
                disabled={shapesCount === 0}
                size="icon"
                variant="ghost"
              >
                <Download />
              </Button>
            }
          />
          <TooltipContent>Export diagram</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {exportInProgress && <ExportDialog />}
    </>
  );
}
