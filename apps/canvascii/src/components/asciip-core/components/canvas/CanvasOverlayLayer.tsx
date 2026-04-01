import { CELL_HEIGHT, CELL_WIDTH } from "./draw";
import { getCanvasCollaboratorStableId, type CanvasCollaboratorPresence, type CanvasResolvedPortalAccess } from "@canvascii/core";
import { Lock, Share2, Trash2, Unlock } from "lucide-react";

type PortalRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const PORTAL_RESIZE_HANDLES = [
  { key: "nw", cursor: "nwse-resize", top: -5, left: -5, right: undefined, bottom: undefined },
  { key: "ne", cursor: "nesw-resize", top: -5, left: undefined, right: -5, bottom: undefined },
  { key: "sw", cursor: "nesw-resize", top: undefined, left: -5, right: undefined, bottom: -5 },
  { key: "se", cursor: "nwse-resize", top: undefined, left: undefined, right: -5, bottom: -5 },
] as const;

function getPortalChrome(portal: CanvasResolvedPortalAccess, selected: boolean) {
  const canEditPortal = portal.access === "edit" || portal.access === "owner";
  const accent = canEditPortal ? "#e2e8f0" : "#94a3b8";

  return {
    accent,
    borderColor: selected ? "rgba(255,255,255,0.68)" : "rgba(255,255,255,0.28)",
    background: "transparent",
    boxShadow: selected
      ? "inset 0 0 0 1px rgba(255,255,255,0.08)"
      : "none",
    pillBorder: "border-slate-800/70",
    pillText: "text-slate-100",
    accessBadgeText: "text-slate-400",
  };
}

export function CanvasOverlayLayer({
  activeCanvasId,
  portals,
  collaborators,
  collaboratorPortalDrafts,
  portalDraftBounds,
  selectedPortalId,
  canManagePortals,
  hoveredBindingLockTarget,
  onToggleBindingLock,
  onSelectPortal,
  onStartMovePortal,
  onStartResizePortal,
  onDeletePortal,
  onOpenPortalShare,
}: {
  activeCanvasId: string;
  portals: CanvasResolvedPortalAccess[];
  collaborators?: CanvasCollaboratorPresence[];
  collaboratorPortalDrafts?: Array<{
    userId: string;
    name: string | null;
    color: string;
    rect: PortalRect;
  }>;
  portalDraftBounds: PortalRect | null;
  selectedPortalId: string | null;
  canManagePortals?: boolean;
  hoveredBindingLockTarget: {
    shapeId: string;
    endpoint: "START" | "END";
    cell: { r: number; c: number };
    locked: boolean;
  } | null;
  onToggleBindingLock?: (payload: { shapeId: string; endpoint: "START" | "END" }) => void;
  onSelectPortal?: (portalId: string) => void;
  onStartMovePortal?: (input: { portalId: string; clientX: number; clientY: number }) => void;
  onStartResizePortal?: (input: {
    portalId: string;
    handle: "nw" | "ne" | "sw" | "se";
    clientX: number;
    clientY: number;
  }) => void;
  onDeletePortal?: (portalId: string) => void;
  onOpenPortalShare?: (portalId: string) => void;
}) {
  return (
    <>
      {portals
        .filter((portal) => portal.canvasId === activeCanvasId)
        .map((portal) => {
          const selected = selectedPortalId === portal.id;
          const chrome = getPortalChrome(portal, selected);
          return (
            <div
              key={portal.id}
              className="pointer-events-none absolute z-10 rounded-md border border-dotted text-[10px] font-medium uppercase tracking-[0.18em]"
              style={{
                top: portal.rect.top * CELL_HEIGHT,
                left: portal.rect.left * CELL_WIDTH,
                width: portal.rect.width * CELL_WIDTH,
                height: portal.rect.height * CELL_HEIGHT,
                borderColor: chrome.borderColor,
                background: chrome.background,
                boxShadow: chrome.boxShadow,
                borderWidth: 1,
              }}
            >
              <div className="pointer-events-auto absolute left-2 top-2 flex items-center gap-1">
                <button
                  type="button"
                  className={`inline-flex cursor-move items-center gap-2 rounded-full border bg-slate-950/92 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-sky-400/60 ${chrome.pillBorder} ${chrome.pillText}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectPortal?.(portal.id);
                    onStartMovePortal?.({
                      portalId: portal.id,
                      clientX: event.clientX,
                      clientY: event.clientY,
                    });
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectPortal?.(portal.id);
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full border border-white/20"
                    style={{ background: chrome.accent }}
                  />
                  {portal.label}
                </button>
                {selected && canManagePortals ? (
                  <>
                    <button
                      type="button"
                      aria-label="Share fence"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-800/70 bg-slate-950/92 text-slate-300 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-sky-400/60 hover:text-white"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenPortalShare?.(portal.id);
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete fence"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-800/70 bg-slate-950/92 text-slate-300 shadow-[0_10px_28px_rgba(0,0,0,0.28)] transition hover:border-rose-400/60 hover:text-white"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDeletePortal?.(portal.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </div>

              {selected && canManagePortals
                ? PORTAL_RESIZE_HANDLES.map((handle) => (
                    <button
                      key={handle.key}
                      type="button"
                      aria-label={`Resize fence ${handle.key}`}
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
                        onSelectPortal?.(portal.id);
                        onStartResizePortal?.({
                          portalId: portal.id,
                          handle: handle.key,
                          clientX: event.clientX,
                          clientY: event.clientY,
                        });
                      }}
                    />
                  ))
                : null}

              <div
                className={`pointer-events-none absolute bottom-2 right-2 rounded-full border border-slate-900/70 bg-slate-950/75 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${chrome.accessBadgeText}`}
              >
                {portal.access}
              </div>
            </div>
          );
        })}

      {portalDraftBounds ? (
        <div
          className="pointer-events-none absolute z-20 rounded-md border border-dotted border-white/45"
          style={{
            top: portalDraftBounds.top * CELL_HEIGHT,
            left: portalDraftBounds.left * CELL_WIDTH,
            width: portalDraftBounds.width * CELL_WIDTH,
            height: portalDraftBounds.height * CELL_HEIGHT,
          }}
        />
      ) : null}

      {collaboratorPortalDrafts?.map((portalDraft) => (
        <div
          key={`portal-draft:${portalDraft.userId}`}
          className="pointer-events-none absolute z-20 rounded-md border border-dotted"
          style={{
            top: portalDraft.rect.top * CELL_HEIGHT,
            left: portalDraft.rect.left * CELL_WIDTH,
            width: portalDraft.rect.width * CELL_WIDTH,
            height: portalDraft.rect.height * CELL_HEIGHT,
            borderColor: "rgba(255,255,255,0.3)",
            borderWidth: 1,
          }}
        >
          <div
            className="absolute left-2 top-2 rounded-full border border-slate-900/70 bg-slate-950/82 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-200"
          >
            {portalDraft.name ?? "Collaborator"} · drafting fence
          </div>
        </div>
      ))}

      {hoveredBindingLockTarget && onToggleBindingLock ? (
        <div
          className="absolute z-30"
          style={{
            top: hoveredBindingLockTarget.cell.r * CELL_HEIGHT - 10,
            left: hoveredBindingLockTarget.cell.c * CELL_WIDTH + 10,
          }}
        >
          <button
            type="button"
            aria-label={hoveredBindingLockTarget.locked ? "Unlock connection point" : "Lock connection point"}
            title={hoveredBindingLockTarget.locked ? "Unlock connection point" : "Lock connection point"}
            className="pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/92 text-slate-200 shadow-[0_10px_28px_rgba(0,0,0,0.42)] transition hover:border-sky-400/70 hover:text-white"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleBindingLock({
                shapeId: hoveredBindingLockTarget.shapeId,
                endpoint: hoveredBindingLockTarget.endpoint,
              });
            }}
          >
            {hoveredBindingLockTarget.locked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Unlock className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ) : null}

      {collaborators?.map((collaborator) =>
        collaborator.viewport && collaborator.viewport.canvasId === activeCanvasId ? (
          <div
            key={`viewport:${getCanvasCollaboratorStableId(collaborator)}`}
            className="pointer-events-none absolute z-[15] rounded-md border border-dashed"
            style={{
              top: collaborator.viewport.rect.top * CELL_HEIGHT,
              left: collaborator.viewport.rect.left * CELL_WIDTH,
              width: collaborator.viewport.rect.width * CELL_WIDTH,
              height: collaborator.viewport.rect.height * CELL_HEIGHT,
              borderColor: `${collaborator.color}bb`,
              background: `${collaborator.color}12`,
              boxShadow: `inset 0 0 0 1px ${collaborator.color}22`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 8,
                top: 8,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 7px",
                borderRadius: 999,
                background: "#020617ee",
                border: `1px solid ${collaborator.color}55`,
                color: "#e2e8f0",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                boxShadow: `0 10px 24px ${collaborator.color}22`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: collaborator.color,
                }}
              />
              {collaborator.name ?? "Collaborator"} view
            </div>
          </div>
        ) : null,
      )}

      {collaborators?.map((collaborator) =>
        collaborator.cursor && collaborator.cursor.canvasId === activeCanvasId ? (
          <div
            key={getCanvasCollaboratorStableId(collaborator)}
            className="pointer-events-none absolute z-20"
            style={{
              top: collaborator.cursor.row * CELL_HEIGHT,
              left: collaborator.cursor.col * CELL_WIDTH,
            }}
          >
            <div
              style={{
                width: CELL_WIDTH,
                height: CELL_HEIGHT,
                border: `1px solid ${collaborator.color}`,
                background: `${collaborator.color}22`,
                boxShadow: `0 0 0 1px ${collaborator.color}44`,
              }}
            />
            <div
              style={{
                marginTop: 2,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 7px",
                borderRadius: 999,
                background: "#020617ee",
                border: `1px solid ${collaborator.color}55`,
                color: "#e2e8f0",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                boxShadow: `0 10px 24px ${collaborator.color}22`,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: collaborator.color,
                  boxShadow: `0 0 0 1px ${collaborator.color}55`,
                }}
              />
              {collaborator.name ?? "Collaborator"}
              <span style={{ color: "#94a3b8" }}>
                {collaborator.activeTool ?? collaborator.status ?? collaborator.access}
              </span>
            </div>
          </div>
        ) : null,
      )}
    </>
  );
}
