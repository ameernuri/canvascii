import { CELL_HEIGHT, CELL_WIDTH } from "./draw";
import type { CanvasPortalView } from "@/lib/canvascii/live-portals";
import { Trash2 } from "lucide-react";

const PORTAL_RESIZE_HANDLES = [
  { key: "nw", cursor: "nwse-resize", top: -5, left: -5, right: undefined, bottom: undefined },
  { key: "ne", cursor: "nesw-resize", top: -5, left: undefined, right: -5, bottom: undefined },
  { key: "sw", cursor: "nesw-resize", top: undefined, left: -5, right: undefined, bottom: -5 },
  { key: "se", cursor: "nwse-resize", top: undefined, left: undefined, right: -5, bottom: -5 },
] as const;

export function CanvasPortalViewLayer({
  activeCanvasId,
  portalViews,
  selectedPortalViewId,
  onSelectPortalView,
  onOpenPortalView,
  onStartMovePortalView,
  onStartResizePortalView,
  onDeletePortalView,
}: {
  activeCanvasId: string;
  portalViews: CanvasPortalView[];
  selectedPortalViewId: string | null;
  onSelectPortalView?: (portalViewId: string) => void;
  onOpenPortalView?: (portalViewId: string) => void;
  onStartMovePortalView?: (input: { portalViewId: string; clientX: number; clientY: number }) => void;
  onStartResizePortalView?: (input: {
    portalViewId: string;
    handle: "nw" | "ne" | "sw" | "se";
    clientX: number;
    clientY: number;
  }) => void;
  onDeletePortalView?: (portalViewId: string) => void;
}) {
  return (
    <>
      {portalViews
        .filter((portalView) => portalView.canvasId === activeCanvasId)
        .map((portalView) => {
          const selected = selectedPortalViewId === portalView.id;
          const isComponent = portalView.viewType === "component";
          const borderColor = isComponent ? "#f59e0b" : portalView.color;
          const showComponentChrome = !isComponent || selected;
          return (
            <div
              key={portalView.id}
              className="pointer-events-none absolute z-[9] rounded-md border text-[10px] font-medium uppercase tracking-[0.18em]"
              style={{
                top: portalView.rect.top * CELL_HEIGHT,
                left: portalView.rect.left * CELL_WIDTH,
                width: portalView.rect.width * CELL_WIDTH,
                height: portalView.rect.height * CELL_HEIGHT,
                borderColor: showComponentChrome ? (selected ? "#eef8ff" : `${borderColor}cc`) : "transparent",
                background: showComponentChrome
                  ? (selected ? `${borderColor}18` : `${borderColor}12`)
                  : "transparent",
                boxShadow: showComponentChrome
                  ? selected
                    ? `0 0 0 1px ${borderColor}55, inset 0 0 0 1px ${borderColor}28`
                    : `0 0 0 1px ${borderColor}24, inset 0 0 0 1px ${borderColor}14`
                  : "none",
                borderWidth: showComponentChrome ? 1 : 0,
              }}
            >
              <button
                type="button"
                aria-label={isComponent ? `Select ${portalView.label}` : `Open ${portalView.label}`}
                className="pointer-events-auto absolute inset-0 rounded-md"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isComponent) {
                    onSelectPortalView?.(portalView.id);
                    return;
                  }
                  onOpenPortalView?.(portalView.id);
                }}
              />
              {showComponentChrome ? (
              <div className="pointer-events-auto absolute left-2 top-2 flex items-center gap-1.5">
                <button
                    type="button"
                    className="inline-flex cursor-move items-center gap-2 rounded-full border border-slate-700/80 bg-slate-950/92 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-100 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-sky-400/60"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectPortalView?.(portalView.id);
                    onStartMovePortalView?.({
                      portalViewId: portalView.id,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    });
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectPortalView?.(portalView.id);
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full border border-white/20"
                    style={{ background: borderColor }}
                  />
                  {portalView.label}
                </button>
                {selected && isComponent ? (
                  <button
                    type="button"
                    aria-label="Edit component source"
                    className="inline-flex h-7 items-center justify-center rounded-full border border-amber-400/40 bg-slate-950/92 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-amber-300/70"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenPortalView?.(portalView.id);
                    }}
                  >
                    Edit
                  </button>
                ) : null}
                {selected ? (
                  <button
                    type="button"
                    aria-label="Delete portal"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/92 text-slate-300 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-rose-400/60 hover:text-white"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeletePortalView?.(portalView.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              ) : null}

              {selected
                ? PORTAL_RESIZE_HANDLES.map((handle) => (
                    <button
                      key={handle.key}
                      type="button"
                      aria-label={`Resize portal ${handle.key}`}
                      className="pointer-events-auto absolute h-3 w-3 rounded-full border border-slate-950 bg-sky-300 shadow-[0_0_0_1px_rgba(125,211,252,0.75)]"
                      style={{
                        cursor: handle.cursor,
                        top: handle.top,
                        left: handle.left,
                        right: handle.right,
                        bottom: handle.bottom,
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectPortalView?.(portalView.id);
                        onStartResizePortalView?.({
                          portalViewId: portalView.id,
                          handle: handle.key,
                          clientX: event.clientX,
                          clientY: event.clientY,
                        });
                      }}
                    />
                  ))
                : null}

              {showComponentChrome ? (
                <div className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-slate-900/70 bg-slate-950/78 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                  {isComponent ? "component" : "portal"}
                </div>
              ) : null}
            </div>
          );
        })}
    </>
  );
}
