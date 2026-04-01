import { useMemo, useState } from "react";
import _ from "lodash";
import {
  Minus,
  Plus,
  RectangleHorizontal,
} from "lucide-react";
import { useAppSelector, useEditorInteractions } from "../../store/hooks";
import { ShapeObject } from "../../store/diagramSlice";
import { selectors } from "../../store/selectors";
import {
  RECTANGLE_TEXT_ALIGN_H,
  RECTANGLE_TEXT_ALIGN_V,
  Style,
} from "../../models/style";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { FloatingOrderMenu } from "./FloatingOrderMenu";

type AlignmentOption = {
  key: string;
  label: string;
  alignH: RECTANGLE_TEXT_ALIGN_H;
  alignV: RECTANGLE_TEXT_ALIGN_V;
};

const ALIGNMENT_OPTIONS: AlignmentOption[] = [
  { key: "TOP_LEFT", label: "Align top left", alignH: "LEFT", alignV: "TOP" },
  { key: "TOP_CENTER", label: "Align top center", alignH: "CENTER", alignV: "TOP" },
  { key: "TOP_RIGHT", label: "Align top right", alignH: "RIGHT", alignV: "TOP" },
  { key: "MIDDLE_LEFT", label: "Align middle left", alignH: "LEFT", alignV: "MIDDLE" },
  {
    key: "MIDDLE_CENTER",
    label: "Align middle center",
    alignH: "CENTER",
    alignV: "MIDDLE",
  },
  {
    key: "MIDDLE_RIGHT",
    label: "Align middle right",
    alignH: "RIGHT",
    alignV: "MIDDLE",
  },
  { key: "BOTTOM_LEFT", label: "Align bottom left", alignH: "LEFT", alignV: "BOTTOM" },
  {
    key: "BOTTOM_CENTER",
    label: "Align bottom center",
    alignH: "CENTER",
    alignV: "BOTTOM",
  },
  {
    key: "BOTTOM_RIGHT",
    label: "Align bottom right",
    alignH: "RIGHT",
    alignV: "BOTTOM",
  },
];

const ALIGNMENT_JUSTIFY: Record<RECTANGLE_TEXT_ALIGN_H, string> = {
  LEFT: "justify-start",
  CENTER: "justify-center",
  RIGHT: "justify-end",
};

const ALIGNMENT_ITEMS: Record<RECTANGLE_TEXT_ALIGN_V, string> = {
  TOP: "items-start",
  MIDDLE: "items-center",
  BOTTOM: "items-end",
};

function AlignmentPreview({
  alignH,
  alignV,
  mixed = false,
  compact = false,
}: {
  alignH: RECTANGLE_TEXT_ALIGN_H;
  alignV: RECTANGLE_TEXT_ALIGN_V;
  mixed?: boolean;
  compact?: boolean;
}) {
  if (mixed) {
    return (
      <div
        className={cn(
          "grid grid-cols-3 gap-px",
          compact ? "h-4 w-4" : "h-5 w-5"
        )}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <div
            key={index}
            className={cn(
              "rounded-[1px] bg-current/18",
              index === 4 && "bg-current/80"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative",
        compact ? "h-4 w-4" : "h-5 w-5"
      )}
    >
      <div
        className={cn(
          "absolute inset-0 flex",
          ALIGNMENT_JUSTIFY[alignH],
          ALIGNMENT_ITEMS[alignV]
        )}
      >
        <div
          className={cn(
            "rounded-full bg-current",
            compact ? "h-[3px] w-[7px]" : "h-[3px] w-[8px]"
          )}
        />
      </div>
    </div>
  );
}

export function RectangleTextFloatingControls() {
  const interactions = useEditorInteractions();
  const [isOpen, setIsOpen] = useState(false);

  const selectedTool = useAppSelector((state) => state.diagram.selectedTool);
  const globalStyle = useAppSelector((state) => state.diagram.globalStyle);
  const selectedShapeObjs: ShapeObject[] = useAppSelector((state) =>
    selectors.selectedShapeObjs(state.diagram)
  );

  const rectangleShapeObjs = selectedShapeObjs.filter(
    (shapeObj) => shapeObj.shape.type === "RECTANGLE"
  );
  const singleRectangleShapeObj =
    rectangleShapeObjs.length === 1 ? rectangleShapeObjs[0] : null;
  const shouldShow =
    selectedTool === "RECTANGLE" || rectangleShapeObjs.length > 0;

  const shapeIds: string[] | undefined =
    selectedShapeObjs.length > 0
      ? selectedShapeObjs.map((shapeObj) => shapeObj.id)
      : undefined;

  const resolveStyleValue = <T extends keyof Style>(key: T): Style[T] | undefined => {
    if (rectangleShapeObjs.length === 0) {
      return globalStyle[key];
    }
    const values = rectangleShapeObjs.map(
      (shapeObj) => (shapeObj.style?.[key] ?? globalStyle[key]) as Style[T]
    );
    const unique = _.uniq(values);
    return unique.length === 1 ? unique[0] : undefined;
  };

  const alignH = resolveStyleValue("rectangleTextAlignH") as
    | RECTANGLE_TEXT_ALIGN_H
    | undefined;
  const alignV = resolveStyleValue("rectangleTextAlignV") as
    | RECTANGLE_TEXT_ALIGN_V
    | undefined;
  const overflow = resolveStyleValue("rectangleTextOverflow");
  const padding = resolveStyleValue("rectangleTextPadding");
  const basePadding = Math.max(
    0,
    Math.floor(
      Number.isFinite(Number(padding))
        ? Number(padding)
        : Number(globalStyle.rectangleTextPadding ?? 1)
    )
  );
  const isTruncate = overflow !== "HIDE";
  const displayedPadding = padding == null ? "—" : String(basePadding);

  const selectedAlignment = useMemo(
    () =>
      alignH && alignV
        ? ALIGNMENT_OPTIONS.find(
            (option) => option.alignH === alignH && option.alignV === alignV
          ) ?? null
        : null,
    [alignH, alignV]
  );

  const setPadding = (value: number) => {
    const clamped = Math.max(0, Math.min(8, Math.floor(value)));
    interactions.setStyle({
      style: { rectangleTextPadding: clamped },
      shapeIds,
    });
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="pointer-events-auto rounded-lg border border-slate-800 bg-slate-950 px-1.5 py-1 shadow-[0_10px_30px_rgba(0,0,0,0.28)]">
      <div className="flex items-center gap-1.5">
        {singleRectangleShapeObj && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-md border border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white"
              aria-label="Edit box label"
              onClick={() => interactions.beginRectangleLabelEdit(singleRectangleShapeObj.id)}
            >
              <RectangleHorizontal className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-5 bg-slate-800" />
          </>
        )}
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger
            type="button"
            aria-label={selectedAlignment?.label ?? "Mixed text alignment"}
            aria-expanded={isOpen}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 bg-slate-900 text-slate-200 transition-colors hover:border-slate-700 hover:text-white",
              isOpen && "border-slate-700"
            )}
          >
            <AlignmentPreview
              alignH={selectedAlignment?.alignH ?? "CENTER"}
              alignV={selectedAlignment?.alignV ?? "MIDDLE"}
              mixed={!selectedAlignment}
              compact
            />
          </PopoverTrigger>
          <PopoverContent
            align="center"
            sideOffset={6}
            className="w-27 rounded-lg border border-slate-800 bg-slate-950 p-1 text-slate-200 shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
          >
            <div className="grid grid-cols-3 gap-1">
              {ALIGNMENT_OPTIONS.map((option) => {
                const isActive =
                  option.alignH === alignH && option.alignV === alignV;

                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-label={option.label}
                    title={option.label}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border text-slate-300 transition-colors",
                      isActive
                        ? "border-sky-400 bg-sky-500/12 text-sky-100"
                        : "border-slate-800 bg-slate-900 hover:border-slate-700 hover:text-white"
                    )}
                    onClick={() => {
                      interactions.setStyle({
                        style: {
                          rectangleTextAlignH: option.alignH,
                          rectangleTextAlignV: option.alignV,
                        },
                        shapeIds,
                      });
                      setIsOpen(false);
                    }}
                  >
                    <AlignmentPreview
                      alignH={option.alignH}
                      alignV={option.alignV}
                    />
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        <Toggle
          variant="outline"
          size="sm"
          pressed={isTruncate}
          aria-label="Toggle truncate overflow"
          className="h-8 min-w-10 border-slate-800 bg-slate-900 px-2 text-[11px] font-medium leading-none text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-white data-[state=on]:border-slate-700 data-[state=on]:bg-slate-900 data-[state=on]:text-white"
          onPressedChange={(pressed) => {
            interactions.setStyle({
              style: {
                rectangleTextOverflow: pressed ? "TRUNCATE" : "HIDE",
              },
              shapeIds,
            });
          }}
        >
          Clip
        </Toggle>

        <Separator orientation="vertical" className="h-5 bg-slate-800" />

        <div className="flex items-center rounded-md border border-slate-800 bg-slate-900">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-r-none px-0 text-slate-300 hover:bg-slate-900 hover:text-white"
            aria-label="Decrease text padding"
            onClick={() => setPadding(basePadding - 1)}
          >
            <Minus />
          </Button>
          <div className="min-w-8 px-1.5 text-center text-[11px] font-medium tabular-nums text-slate-300">
            {displayedPadding}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-l-none px-0 text-slate-300 hover:bg-slate-900 hover:text-white"
            aria-label="Increase text padding"
            onClick={() => setPadding(basePadding + 1)}
          >
            <Plus />
          </Button>
        </div>
        <Separator orientation="vertical" className="h-5 bg-slate-800" />
        <FloatingOrderMenu />
      </div>
    </div>
  );
}
