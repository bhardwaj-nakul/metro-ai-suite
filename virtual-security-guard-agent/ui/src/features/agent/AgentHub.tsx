// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ImageDown, Loader2, PanelRight, SquarePen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IMAGE_ONLY_PROMPT } from "@/protocol/feedback";
import { useInvestigationStore } from "@/stores/investigation";
import { useSettingsStore } from "@/stores/settings";
import { CaseFilePanel } from "./CaseFilePanel";
import { ATTACH_INPUT_ID, Composer, type ComposerSubmit } from "./Composer";
import { HistoryMenu } from "./HistoryMenu";
import { MessageList } from "./MessageList";
import { firstImageFile, useAttachment } from "./useAttachment";

/**
 * Argus: the Virtual Security Guard Agent workspace. Kept mounted across route
 * changes (see AppShell) so a running investigation keeps streaming.
 */
export function AgentHub() {
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const onArgus = pathname === "/argus";

  const turns = useInvestigationStore((s) => s.turns);
  const phase = useInvestigationStore((s) => s.phase);
  const busy = useInvestigationStore((s) => s.busy);
  const stopping = useInvestigationStore((s) => s.stopping);
  const sessionId = useInvestigationStore((s) => s.sessionId);
  const loadingSession = useInvestigationStore((s) => s.loadingSession);
  const { send, retry, stop, reset, resume } = useInvestigationStore.getState();
  const caseFileOpen = useSettingsStore((s) => s.caseFileOpen);
  const setCaseFileOpen = useSettingsStore((s) => s.setCaseFileOpen);

  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const { attachment, attach, clear, take } = useAttachment();
  const fileInput = useRef<HTMLInputElement>(null);

  const urlSession = onArgus ? (params.get("session") ?? undefined) : undefined;

  // URL -> store: open the investigation named in ?session=. A change made
  // during a run (e.g. browser Back) is applied when the run ends.
  useEffect(() => {
    if (!urlSession || urlSession === sessionId || busy) return;
    resume(urlSession).catch((e) => {
      toast.error("Couldn't open that investigation", {
        description: (e as Error).message,
      });
      reset();
      setParams((p) => (p.delete("session"), p), { replace: true });
    });
    // Only react to the URL changing or a run ending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSession, busy]);

  // Store -> URL: a new investigation got its Hermes session id. A session
  // already in the URL wins (e.g. Reports > Open in Argus): the effect above
  // opens it, and writing the old id here would undo that.
  useEffect(() => {
    if (!onArgus || !sessionId || params.get("session")) return;
    setParams((p) => (p.set("session", sessionId), p), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, onArgus]);

  function newInvestigation() {
    reset();
    clear();
    setDraft("");
    setParams((p) => (p.delete("session"), p), { replace: true });
  }

  function onSubmit(s: ComposerSubmit) {
    if (loadingSession) return;
    if (attachment?.status === "error") {
      toast.error("The photo wasn't uploaded", {
        description: "Remove it or attach it again before sending.",
      });
      return;
    }
    const image = take();
    const text = s.text || (image ? IMAGE_ONLY_PROMPT : "");
    if (!text) return;
    setDraft("");
    void send(text, { image });
  }

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) e.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = firstImageFile(e.dataTransfer.files);
      if (file) void attach(file);
      else if (e.dataTransfer.files.length)
        toast.warning("Only images can be used as a search reference.");
    },
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="relative flex min-w-0 flex-1 flex-col" {...dropProps}>
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
          <span className="flex-1" />
          <HistoryMenu
            currentId={sessionId}
            disabled={busy || loadingSession}
            onOpen={(id) => setParams({ session: id })}
            onDeletedCurrent={newInvestigation}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={newInvestigation}
            disabled={busy || !turns.length}
          >
            <SquarePen /> <span className="hidden md:inline">New</span>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "hidden lg:inline-flex",
                  caseFileOpen && "bg-accent",
                )}
                onClick={() => setCaseFileOpen(!caseFileOpen)}
                aria-pressed={caseFileOpen}
                aria-label="Toggle case file"
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {caseFileOpen ? "Hide" : "Show"} case file
            </TooltipContent>
          </Tooltip>
        </div>

        {loadingSession ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Opening investigation
          </div>
        ) : (
          <MessageList
            turns={turns}
            busy={busy}
            onRetry={(id) => void retry(id)}
            onPick={setDraft}
            onAttachClick={() => fileInput.current?.click()}
          />
        )}

        <input
          ref={fileInput}
          id={ATTACH_INPUT_ID}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void attach(f);
            e.target.value = "";
          }}
        />
        <Composer
          value={draft}
          onChange={setDraft}
          phase={phase}
          busy={busy}
          stopping={stopping}
          attachment={attachment}
          onAttach={(f) => void attach(f)}
          onClearAttachment={clear}
          onSubmit={onSubmit}
          onStop={() => void stop()}
        />

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-brand-accent bg-background/85 text-brand-accent">
            <ImageDown className="size-8" />
            <p className="text-sm font-medium">
              Drop a photo to search the footage for it
            </p>
          </div>
        )}
      </div>
      {caseFileOpen && <CaseFilePanel />}
    </div>
  );
}
