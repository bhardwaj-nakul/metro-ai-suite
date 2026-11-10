// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getAdapters } from "@/adapters";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useInvestigations } from "@/hooks/queries";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";

interface Props {
  currentId?: string;
  disabled?: boolean;
  onOpen: (sessionId: string) => void;
  /** Called after the open investigation was deleted. */
  onDeletedCurrent: () => void;
}

/** Recent investigations, backed by Hermes sessions with the VSG title prefix. */
export function HistoryMenu({
  currentId,
  disabled,
  onOpen,
  onDeletedCurrent,
}: Props) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; title: string }>();
  const qc = useQueryClient();
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInvestigations();

  async function remove() {
    if (!deleting) return;
    await getAdapters().hermes.deleteSession(deleting.id);
    toast.success(`Deleted "${deleting.title}"`);
    await qc.invalidateQueries({ queryKey: ["hermes", "sessions"] });
    if (deleting.id === currentId) onDeletedCurrent();
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" disabled={disabled}>
            <History /> <span className="hidden md:inline">History</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 p-0">
          <div className="border-b px-3 py-2 text-sm font-semibold">
            Recent investigations
          </div>
          <div className="max-h-96 overflow-auto py-1">
            {isLoading && (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading
              </p>
            )}
            {error && (
              <p className="px-3 py-4 text-sm text-destructive">
                Couldn't load history: {(error as Error).message}
              </p>
            )}
            {data?.length === 0 && (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No investigations yet.
              </p>
            )}
            <ul>
              {data?.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-1 pr-1 hover:bg-accent",
                    s.id === currentId && "bg-accent",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-3 py-2 text-left"
                    onClick={() => {
                      setOpen(false);
                      onOpen(s.id);
                    }}
                  >
                    <span className="block truncate text-sm">
                      {s.title || "Untitled"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {timeAgo(s.lastActive ?? s.startedAt)}
                      {s.messageCount ? `, ${s.messageCount} messages` : ""}
                    </span>
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="opacity-40 group-focus-within:opacity-100 group-hover:opacity-100"
                    onClick={() =>
                      setDeleting({ id: s.id, title: s.title || "Untitled" })
                    }
                    aria-label={`Delete ${s.title}`}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
            {hasNextPage && (
              <Button
                size="sm"
                variant="ghost"
                className="w-full"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage && <Loader2 className="animate-spin" />}
                Load older
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={`Delete "${deleting?.title}"?`}
        description="This removes the Argus session from Hermes and can't be undone."
        action="Delete investigation"
        errorTitle="Couldn't delete the investigation"
        onConfirm={remove}
      />
    </>
  );
}
