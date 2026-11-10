// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { AlertTriangle, Check, ChevronRight, Loader2 } from "lucide-react";
import type { ToolCallView } from "@/stores/investigation";
import { redactUrl } from "@/lib/urls";
import { cn } from "@/lib/utils";

const FRIENDLY: Record<string, string> = {
  vss_search_video: "Searching footage",
  vss_watch_search: "Live watch",
  vss_stop_watch: "Stopping live watch",
  vss_list_streams: "Listing live cameras",
  vss_add_stream: "Adding a camera",
  vss_update_stream: "Updating a camera",
  vss_remove_stream: "Removing a camera",
  vss_get_media_frame: "Fetching a frame",
  vss_search_image: "Searching by image",
  vss_list_tags: "Listing cameras",
  vss_get_query: "Reading search results",
  skill_view: "Loading skill",
  skills_list: "Checking skills",
  vision_analyze: "Looking at an image",
};

function friendly(name: string) {
  return FRIENDLY[name] ?? name.replace(/_/g, " ");
}

/** One agent tool call; expands to show the (truncated) result preview. */
export function ToolChip({ tool }: { tool: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const detail = redactUrl(tool.preview ?? tool.args);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => detail && setOpen((o) => !o)}
        aria-expanded={detail ? open : undefined}
        className={cn(
          "inline-flex items-center gap-1.5 border bg-card px-2 py-1 text-muted-foreground transition-colors",
          detail && "hover:text-foreground",
          tool.status === "error" &&
            "status-error border-[var(--status-border)] text-[var(--status-fg)]",
        )}
      >
        {tool.status === "running" ? (
          <Loader2 className="size-3 animate-spin text-brand-accent" />
        ) : tool.status === "error" ? (
          <AlertTriangle className="size-3" />
        ) : (
          <Check className="size-3 text-confirm" />
        )}
        <span className="font-medium">{friendly(tool.name)}</span>
        <span className="font-mono text-[0.6875rem] opacity-60">
          {tool.name}
        </span>
        {detail && (
          <ChevronRight
            className={cn("size-3 transition-transform", open && "rotate-90")}
          />
        )}
      </button>
      {open && detail && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all border bg-muted/50 p-2 font-mono text-[0.6875rem] leading-relaxed text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  );
}
