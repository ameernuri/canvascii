import type { ReactNode } from "react";
import { ToolbarBoundaryTools, ToolbarTools } from "./ToolbarTools";
import { ToolbarExport } from "./ToolbarExport";
import { ToolbarOverflowMenu } from "./ToolbarOverflowMenu";
import { Separator } from "@/components/ui/separator";
import { editorTheme } from "../../theme";
import { FooterHistory } from "../footer/FooterHistory";

export default function Toolbar({
  leadingContent,
  fullscreenContent,
  trailingContent,
  canCreateFence,
  canCreatePortal,
  showHistory = true,
}: {
  leadingContent?: ReactNode;
  fullscreenContent?: ReactNode;
  trailingContent?: ReactNode;
  canCreateFence?: boolean;
  canCreatePortal?: boolean;
  showHistory?: boolean;
}) {
  return (
    <header
      style={{
        borderBottom: `1px solid ${editorTheme.chrome.border}`,
        background: editorTheme.chrome.background,
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div id="left-toolbar" className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {leadingContent ? (
            <>
              <div className="flex min-w-0 items-center gap-2">{leadingContent}</div>
              <Separator orientation="vertical" className="h-7 bg-slate-700" />
            </>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto scrollbar-none">
            <ToolbarTools />
          </div>
        </div>
        <div id="right-toolbar" className="flex flex-none items-center gap-2">
          {showHistory ? <FooterHistory /> : null}
          {showHistory && fullscreenContent ? <Separator orientation="vertical" className="h-7 bg-slate-700" /> : null}
          {fullscreenContent ? <div className="flex items-center gap-2">{fullscreenContent}</div> : null}
          <Separator orientation="vertical" className="h-7 bg-slate-700" />
          <ToolbarExport />
          {canCreateFence || canCreatePortal ? (
            <>
              <Separator orientation="vertical" className="h-7 bg-slate-700" />
              <ToolbarBoundaryTools canCreateFence={canCreateFence} canCreatePortal={canCreatePortal} />
            </>
          ) : null}
          <Separator orientation="vertical" className="h-7 bg-slate-700" />
          <ToolbarOverflowMenu />
          {trailingContent ? <Separator orientation="vertical" className="h-7 bg-slate-700" /> : null}
          {trailingContent ? <div className="flex items-center gap-2">{trailingContent}</div> : null}
        </div>
      </div>
    </header>
  );
}
