import { useMemo, useState } from "react";
import { Bot, Crosshair, Search, UserRound } from "lucide-react";
import type { CanvasCollaboratorPresence, CanvasResolvedPortalAccess } from "@canvascii/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type PresenceEntry = {
  id: string;
  name: string;
  actorType: "human" | "agent" | "system";
  color: string;
  activeTool: string | null;
  status: string | null;
  cursor: {
    canvasId: string;
    row: number;
    col: number;
  } | null;
  portalLabel: string | null;
  isSelf?: boolean;
};

type TextSearchEntry = {
  id: string;
  text: string;
  row: number;
  col: number;
  type: string;
};

function findPortalLabelForCursor(
  portals: CanvasResolvedPortalAccess[],
  cursor: PresenceEntry["cursor"],
) {
  if (!cursor) return null;
  const portal = portals.find(
    (candidate) =>
      candidate.canvasId === cursor.canvasId &&
      cursor.row >= candidate.rect.top &&
      cursor.row < candidate.rect.top + candidate.rect.height &&
      cursor.col >= candidate.rect.left &&
      cursor.col < candidate.rect.left + candidate.rect.width,
  );

  return portal?.label ?? null;
}

export function CanvasPresencePanel({
  currentCollaboratorName,
  currentCursor,
  currentTool,
  textSearchEntries,
  collaborators,
  activeCanvasId,
  portals,
  portalMirrorConfig,
  onPortalMirrorConfigChange,
  onJumpToCursor,
}: {
  currentCollaboratorName?: string | null;
  currentCursor: {
    row: number;
    col: number;
  } | null;
  currentTool: string | null;
  textSearchEntries: TextSearchEntry[];
  collaborators: CanvasCollaboratorPresence[];
  activeCanvasId: string;
  portals: CanvasResolvedPortalAccess[];
  portalMirrorConfig?: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  };
  onPortalMirrorConfigChange?: (next: {
    sourcePortalId: string | null;
    targetPortalId: string | null;
  }) => void;
  onJumpToCursor: (cursor: { row: number; col: number }) => void;
}) {
  const [query, setQuery] = useState("");

  const entries = useMemo(() => {
    const selfEntry: PresenceEntry = {
      id: "self",
      name: currentCollaboratorName?.trim() || "You",
      actorType: "human",
      color: "#e2e8f0",
      activeTool: currentTool,
      status: currentCursor ? "navigating" : "idle",
      cursor: currentCursor ? { canvasId: activeCanvasId, ...currentCursor } : null,
      portalLabel: findPortalLabelForCursor(portals, currentCursor ? { canvasId: activeCanvasId, ...currentCursor } : null),
      isSelf: true,
    };

    const remoteEntries: PresenceEntry[] = collaborators.map((collaborator) => ({
      id: collaborator.sessionId || collaborator.actorId || collaborator.userId,
      name: collaborator.name?.trim() || "Collaborator",
      actorType: collaborator.actorType || "human",
      color: collaborator.color,
      activeTool: collaborator.activeTool,
      status: collaborator.status || null,
      cursor: collaborator.cursor,
      portalLabel: findPortalLabelForCursor(portals, collaborator.cursor),
    }));

    return [selfEntry, ...remoteEntries];
  }, [activeCanvasId, collaborators, currentCollaboratorName, currentCursor, currentTool, portals]);

  const matchingTextEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    return textSearchEntries.filter((entry) => entry.text.toLowerCase().includes(needle)).slice(0, 12);
  }, [query, textSearchEntries]);

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-40 w-[20rem] max-w-[calc(100%-2rem)]">
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-white/10 bg-slate-950/88 shadow-[0_18px_60px_rgba(2,6,23,0.52)] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Canvas Search
            </div>
            <div className="text-sm font-medium text-slate-100">
              Search text, jump to hits, track collaborators
            </div>
          </div>
          <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
            <Crosshair className="h-3 w-3" />
            Search
          </div>
        </div>
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search canvas text"
              className="h-8 border-white/10 bg-white/5 pl-8 text-sm text-white placeholder:text-slate-500"
            />
          </div>
        </div>
        {query.trim() ? (
          <div className="border-b border-white/10 px-2 py-2">
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Text Matches
            </div>
            <div className="space-y-1">
              {matchingTextEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-slate-500">
                  No matching text on the active canvas.
                </div>
              ) : (
                matchingTextEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left transition hover:border-white/15 hover:bg-white/[0.06]"
                    onClick={() => onJumpToCursor({ row: entry.row, col: entry.col })}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-100">
                        {entry.text}
                      </span>
                      <span className="block text-[11px] text-slate-500">
                        {entry.type} at {entry.row}, {entry.col}
                      </span>
                    </span>
                    <Crosshair className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
        {portals.length >= 2 ? (
          <div className="border-b border-white/10 px-3 py-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Mirror Flow
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <NativeSelect
                size="sm"
                value={portalMirrorConfig?.sourcePortalId ?? ""}
                onChange={(event) =>
                  onPortalMirrorConfigChange?.({
                    sourcePortalId: event.target.value || null,
                    targetPortalId: portalMirrorConfig?.targetPortalId ?? null,
                  })
                }
                className="w-full"
              >
                <NativeSelectOption value="">
                  Off
                </NativeSelectOption>
                {portals.map((portal) => (
                  <NativeSelectOption key={portal.id} value={portal.id}>
                    {portal.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                To
              </span>
              <NativeSelect
                size="sm"
                value={portalMirrorConfig?.targetPortalId ?? ""}
                onChange={(event) =>
                  onPortalMirrorConfigChange?.({
                    sourcePortalId: portalMirrorConfig?.sourcePortalId ?? null,
                    targetPortalId: event.target.value || null,
                  })
                }
                className="w-full"
              >
                <NativeSelectOption value="">
                  Off
                </NativeSelectOption>
                {portals.map((portal) => (
                  <NativeSelectOption key={portal.id} value={portal.id}>
                    {portal.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        ) : null}
        <div className="border-b border-white/10 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Live Presence
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {entries.length} collaborator{entries.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto px-2 py-2">
          {entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full border border-white/15"
                        style={{ background: entry.color }}
                      />
                      <span className="truncate text-sm font-medium text-slate-100">
                        {entry.name}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/6 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        {entry.actorType}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      <span className="rounded-full border border-white/8 bg-slate-900/80 px-1.5 py-0.5 font-semibold uppercase tracking-[0.16em] text-slate-300">
                        {entry.activeTool || "idle"}
                      </span>
                      {entry.portalLabel ? <span>in {entry.portalLabel}</span> : null}
                      {entry.status ? <span>{entry.status}</span> : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500">
                    {entry.cursor ? `${entry.cursor.row}, ${entry.cursor.col}` : "off canvas"}
                  </span>
                </div>
                {entry.cursor ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      {entry.actorType === "agent" ? <Bot className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                      {entry.isSelf ? "Your cursor" : "Live cursor"}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-full border border-white/10 bg-white/5 px-2.5 text-[11px] text-slate-100 hover:bg-white/10"
                      onClick={() => onJumpToCursor({ row: entry.cursor!.row, col: entry.cursor!.col })}
                    >
                      Jump
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
