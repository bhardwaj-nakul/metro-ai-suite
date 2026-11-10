// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { getAdapters } from "@/adapters";
import { env } from "@/config/env";
import { useHealth } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function Dot({ ok, loading }: { ok?: boolean; loading: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        loading
          ? "bg-muted-foreground/40"
          : ok
            ? "bg-confirm"
            : "bg-destructive",
      )}
    />
  );
}

/** Backend reachability (through the proxy), mock-mode flag and version. */
export function StatusFooter() {
  const { data, isLoading } = useHealth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const rows = [
    { name: "Hermes", ok: data?.hermes },
    { name: "VSS", ok: data?.vss },
  ];
  const summary = rows
    .map(
      (r) =>
        `${r.name}: ${isLoading ? "checking" : r.ok ? "reachable" : "unreachable"}`,
    )
    .join(", ");
  if (collapsed)
    return (
      <Tooltip>
        {/* A button so keyboard users can focus it to read the tooltip. */}
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex cursor-default flex-col items-center gap-1.5 rounded-sm py-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={`Backend status. ${summary}`}
          >
            {rows.map((r) => (
              <Dot key={r.name} ok={r.ok} loading={isLoading} />
            ))}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{summary}</TooltipContent>
      </Tooltip>
    );
  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 text-xs text-muted-foreground">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <Dot ok={r.ok} loading={isLoading} />
          <span className="text-foreground/80">{r.name}</span>
          <span className="ml-auto">
            {isLoading ? "Checking" : r.ok ? "Reachable" : "Unreachable"}
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between border-t pt-2">
        <span>Version {env.appVersion}</span>
        {getAdapters().mock && (
          <span className="status-pending rounded-sm border border-[var(--status-border)] bg-[var(--status-bg)] px-1.5 py-px text-[0.6875rem] font-medium text-[var(--status-fg)]">
            Mock data
          </span>
        )}
      </div>
    </div>
  );
}
