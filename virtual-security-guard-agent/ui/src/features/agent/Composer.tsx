// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import {
  ArrowUp,
  ImagePlus,
  Loader2,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { InvestigationPhase } from "@/stores/investigation";
import { firstImageFile, type Attachment } from "./useAttachment";

const PLACEHOLDER: Record<InvestigationPhase, string> = {
  idle: "Describe who to look for, or drop a photo of them",
  searching: "Argus is searching…",
  validating: "Review the matches above, or tell Argus how to refine",
  tracing: "Argus is tracing the route…",
  traced: "Ask a follow-up, or generate a report from the route card",
  reporting: "Argus is drafting the report…",
};

/** Ids other parts of the Argus page use to hand the operator back to the composer. */
export const PROMPT_ID = "argus-prompt";
export const ATTACH_INPUT_ID = "argus-attach";

export interface ComposerSubmit {
  text: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  phase: InvestigationPhase;
  busy: boolean;
  stopping: boolean;
  attachment?: Attachment;
  onAttach: (file: File) => void;
  onClearAttachment: () => void;
  onSubmit: (s: ComposerSubmit) => void;
  onStop: () => void;
}

function AttachmentChip({
  a,
  onClear,
}: {
  a: Attachment;
  onClear: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center gap-2 border bg-background p-1 pr-2 text-xs",
        a.status === "error" && "border-destructive/50",
      )}
    >
      {a.localUrl ? (
        <img src={a.localUrl} alt="" className="size-10 object-cover" />
      ) : (
        <div className="size-10 bg-muted" />
      )}
      <div className="min-w-0 max-w-48">
        <p className="truncate font-medium">{a.name}</p>
        <p
          className={cn(
            "flex items-center gap-1 text-muted-foreground",
            a.status === "error" && "text-destructive",
          )}
        >
          {a.status === "uploading" && (
            <>
              <Loader2 className="size-3 animate-spin" /> Uploading to VSS
            </>
          )}
          {a.status === "ready" && "Ready as search reference"}
          {a.status === "error" && (
            <>
              <TriangleAlert className="size-3 shrink-0" />
              <span className="truncate" title={a.error}>
                {a.error}
              </span>
            </>
          )}
        </p>
      </div>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        onClick={onClear}
        aria-label="Remove image"
      >
        <X />
      </Button>
    </div>
  );
}

/** Prompt box: text and an optional reference image. */
export function Composer({
  value,
  onChange,
  phase,
  busy,
  stopping,
  attachment,
  onAttach,
  onClearAttachment,
  onSubmit,
  onStop,
}: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grow with the text. The hub stays mounted but `hidden` on other routes
  // (AppShell keep-alive), where scrollHeight is 0, so skip measuring until
  // laid out and re-measure when the size changes (e.g. the route is shown).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const fit = () => {
      if (!el.offsetParent) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);

  useEffect(() => {
    if (!busy) textRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const uploading = attachment?.status === "uploading";
  const hasContent = !!value.trim() || attachment?.status === "ready";
  const canSend = !busy && hasContent && !uploading;

  function submit(text = value) {
    if (busy || uploading) return;
    if (!text.trim() && attachment?.status !== "ready") return;
    onSubmit({ text: text.trim() });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border bg-background shadow-sm focus-within:border-brand-accent/60 focus-within:ring-2 focus-within:ring-brand-accent/15"
      >
        {attachment && (
          <div className="px-3 pt-3">
            <AttachmentChip a={attachment} onClear={onClearAttachment} />
          </div>
        )}
        <label htmlFor={PROMPT_ID} className="sr-only">
          Message Argus
        </label>
        <textarea
          id={PROMPT_ID}
          ref={textRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const file = firstImageFile(e.clipboardData.items);
            if (file) {
              e.preventDefault();
              onAttach(file);
            }
          }}
          placeholder={PLACEHOLDER[phase]}
          className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3 pb-1 font-prose text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAttach(f);
              e.target.value = "";
            }}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                onClick={() => fileRef.current?.click()}
                aria-label="Attach a reference image"
              >
                <ImagePlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Attach a reference image (or drop / paste one)
            </TooltipContent>
          </Tooltip>
          <span className="flex-1" />
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Square className="fill-current" />
              )}
              {stopping ? "Stopping" : "Stop"}
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              disabled={!canSend}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
      <p className="mt-1.5 text-center text-[0.6875rem] text-muted-foreground">
        Argus can be wrong. Always confirm sightings against the footage before
        acting.
      </p>
    </div>
  );
}
