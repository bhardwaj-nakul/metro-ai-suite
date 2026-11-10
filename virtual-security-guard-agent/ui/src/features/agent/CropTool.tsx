// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { Check, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  canvasToJpegBlob,
  captureFrame,
  clampUnitBox,
  containRect,
  cropCanvas,
  mediaSize,
  meetsMinPx,
  waitForFrame,
  type CropMedia,
  type UnitBox,
} from "@/lib/crop";

const MIN_PX = 48;

interface Props {
  /** The paused video (or still image) shown underneath the overlay. */
  mediaRef: RefObject<CropMedia | null>;
  /** Called with the cropped region of the current frame as a JPEG blob. */
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
  saving?: boolean;
}

type Drag =
  | { mode: "move"; startX: number; startY: number; orig: UnitBox }
  | { mode: "draw"; startX: number; startY: number };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Snipping-tool overlay for the frame on screen. It sits over the media
 * element's visible picture (letterboxing excluded); the operator drags a
 * rectangle, and saving cuts that region out of the current frame at the
 * media's native resolution.
 */
export function CropTool({ mediaRef, onCrop, onCancel, saving }: Props) {
  const overlay = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<UnitBox | null>(null);
  const [error, setError] = useState<string>();
  const drag = useRef<Drag | null>(null);
  // Set until the crop is handed over; `saving` lags a render behind.
  const capturing = useRef(false);

  // Track where the picture is drawn inside the media element.
  useEffect(() => {
    const m = mediaRef.current;
    if (!m) return;
    const measure = () => {
      const parent = m.offsetParent as HTMLElement | null;
      const mr = m.getBoundingClientRect();
      const pr = parent?.getBoundingClientRect() ?? mr;
      const n = mediaSize(m);
      const c = containRect(mr.width, mr.height, n.width, n.height);
      setNatural(n);
      setRect({
        x: mr.left - pr.left + c.x,
        y: mr.top - pr.top + c.y,
        w: c.w,
        h: c.h,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(m);
    m.addEventListener("loadedmetadata", measure);
    m.addEventListener("load", measure);
    m.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      m.removeEventListener("loadedmetadata", measure);
      m.removeEventListener("load", measure);
      m.removeEventListener("resize", measure);
    };
  }, [mediaRef]);

  /** Client (pointer) position to unit coordinates in the frame. */
  const toUnit = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || saving) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setError(undefined);
    const p = toUnit(e);
    const inside =
      box &&
      p.x >= box.x &&
      p.x <= box.x + box.w &&
      p.y >= box.y &&
      p.y <= box.y + box.h;
    if (inside && box)
      drag.current = { mode: "move", startX: p.x, startY: p.y, orig: box };
    else {
      drag.current = { mode: "draw", startX: p.x, startY: p.y };
      setBox(null);
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const p = toUnit(e);
    if (d.mode === "move") {
      const { orig } = d;
      setBox({
        ...orig,
        x: Math.max(0, Math.min(1 - orig.w, orig.x + p.x - d.startX)),
        y: Math.max(0, Math.min(1 - orig.h, orig.y + p.y - d.startY)),
      });
    } else {
      setBox(clampUnitBox(d.startX, d.startY, p.x - d.startX, p.y - d.startY));
    }
  }

  function onPointerUp() {
    drag.current = null;
  }

  const ready = natural.width > 0 && natural.height > 0;
  const big =
    !!box && ready && meetsMinPx(box, natural.width, natural.height, MIN_PX);
  const drawn = !!box && box.w > 0 && box.h > 0;
  const tooSmall = drawn && ready && !big;
  const notLoaded = drawn && !ready;

  async function save() {
    const m = mediaRef.current;
    if (!m || !box || !big || saving || capturing.current) return;
    capturing.current = true;
    try {
      await waitForFrame(m);
      const cut = cropCanvas(captureFrame(m), box);
      onCrop(await canvasToJpegBlob(cut, 0.92));
    } catch (e) {
      // A cross-origin clip taints the canvas; say so instead of failing silently.
      setError(
        e instanceof DOMException && e.name === "SecurityError"
          ? "This clip can't be cropped (cross-origin video)."
          : (e as Error).message,
      );
    } finally {
      capturing.current = false;
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Enter on a focused control (Cancel, Redo, Frame >) is that control's.
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("button, a, input, textarea, select, [contenteditable]"))
        return;
      if (e.key === "Enter") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!rect) return null;
  const px = box && {
    left: box.x * rect.w,
    top: box.y * rect.h,
    width: box.w * rect.w,
    height: box.h * rect.h,
  };
  const outW = box ? Math.round(box.w * natural.width) : 0;
  const outH = box ? Math.round(box.h * natural.height) : 0;

  return (
    <div
      ref={overlay}
      className="absolute z-10 cursor-crosshair overflow-hidden select-none"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {px && px.width > 0 && px.height > 0 ? (
        <div
          className="absolute cursor-move border-2 border-[var(--energy-blue,#4ea1ff)]"
          style={{ ...px, boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)" }}
        >
          <span className="pointer-events-none absolute -top-6 left-0 bg-black/70 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-white">
            {outW} × {outH}px
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/60" />
      )}

      {!box && (
        <p className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 bg-black/60 px-3 py-1.5 text-center text-sm text-white">
          Drag a rectangle around the person
        </p>
      )}

      <div
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 bg-black/75 px-2 py-1.5 text-xs text-white shadow-lg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {error ? (
          <span className="flex items-center gap-1 text-amber-300">
            <TriangleAlert className="size-3" /> {error}
          </span>
        ) : notLoaded ? (
          <span className="flex items-center gap-1 text-amber-300">
            <TriangleAlert className="size-3" /> The frame isn't loaded yet
          </span>
        ) : tooSmall ? (
          <span className="flex items-center gap-1 text-amber-300">
            <TriangleAlert className="size-3" /> Too small — at least {MIN_PX}px
          </span>
        ) : (
          <span className="text-white/80">
            {box ? "Drag inside to move · Enter to save" : "Esc to cancel"}
          </span>
        )}
        {box && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-white hover:bg-white/15 hover:text-white"
            onClick={() => setBox(null)}
            disabled={saving}
          >
            <RotateCcw /> Redo
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-white hover:bg-white/15 hover:text-white"
          onClick={onCancel}
          disabled={saving}
        >
          <X /> Cancel
        </Button>
        <Button
          size="sm"
          className="h-7"
          disabled={!big || saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Check />} Save crop
        </Button>
      </div>
    </div>
  );
}
