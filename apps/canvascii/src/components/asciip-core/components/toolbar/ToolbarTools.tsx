import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { Tool } from "../../store/diagramSlice";
import {
  Fence,
  Hand,
  Minus,
  MousePointer2,
  Square,
  SquareEqual,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ToolDefinition = {
  tool: Tool;
  label: string;
  title: string;
  icon: typeof MousePointer2;
};

const PRIMARY_TOOLS: ToolDefinition[] = [
  { tool: "SELECT", label: "Select tool", title: "Select (V)", icon: MousePointer2 },
  { tool: "PAN", label: "Pan canvas", title: "Pan canvas (Space)", icon: Hand },
  { tool: "RECTANGLE", label: "Create rectangle", title: "Add rectangle (R)", icon: Square },
  { tool: "LINE", label: "Create line", title: "Add line/path (L, A, P)", icon: Minus },
  { tool: "TEXT", label: "Add text", title: "Add text (T)", icon: Type },
];

const WORLD_TOOLS: ToolDefinition[] = [
  { tool: "FENCE", label: "Create fence", title: "Create fence (O)", icon: Fence },
  { tool: "PORTAL", label: "Create portal", title: "Create portal", icon: SquareEqual },
];

function ToolButton({
  tool,
  selectedTool,
  onSelect,
  label,
  title,
  icon: Icon,
}: ToolDefinition & {
  selectedTool: Tool;
  onSelect: (tool: Tool) => void;
}) {
  const isActive = selectedTool === tool;

  return (
    <Tooltip>
      <TooltipTrigger render={
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          onClick={() => onSelect(tool)}
          className={cn(
            "h-9 w-9 rounded-md border text-slate-300 transition-colors",
            isActive
              ? "border-sky-300 bg-sky-500 text-white shadow-[0_0_0_1px_rgba(125,211,252,0.95)_inset,0_0_14px_rgba(14,165,233,0.42)]"
              : "border-slate-700 bg-transparent hover:bg-slate-800 hover:text-slate-100"
          )}
        >
          <Icon className="h-4 w-4" />
        </Button>
      } />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function ToolStrip({
  tools,
}: {
  tools: ToolDefinition[];
}) {
  const interactions = useEditorInteractions();
  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {tools.map((tool) => (
          <ToolButton
            key={tool.tool}
            {...tool}
            selectedTool={selectedTool}
            onSelect={(nextTool) => {
              if (nextTool !== selectedTool) {
                interactions.setTool(nextTool);
              }
            }}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

export function ToolbarTools() {
  return <ToolStrip tools={PRIMARY_TOOLS} />;
}

export function ToolbarBoundaryTools({
  canCreateFence = false,
  canCreatePortal = true,
}: {
  canCreateFence?: boolean;
  canCreatePortal?: boolean;
}) {
  const tools = WORLD_TOOLS.filter((tool) =>
    tool.tool === "FENCE" ? canCreateFence : canCreatePortal
  );

  if (tools.length === 0) {
    return null;
  }

  return <ToolStrip tools={tools} />;
}
