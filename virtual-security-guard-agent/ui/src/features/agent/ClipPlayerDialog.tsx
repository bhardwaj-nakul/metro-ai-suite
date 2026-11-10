// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Scissors } from "lucide-react";
import { toast } from "sonner";
import { getAdapters } from "@/adapters";
import type { VssHit } from "@/adapters/vss/types";
import { hitCameraLabel } from "@/lib/hits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HitThumb } from "@/components/shared/media";
import type { CropMedia } from "@/lib/crop";
import { prepareSearchImage } from "@/lib/images";
import { formatClock, formatDateTime, formatOffset, hitTime } from "@/lib/time";
import { withTimeFragment } from "@/lib/urls";
import { cn } from "@/lib/utils";
import { selectCameraByTag, useCamerasStore } from "@/stores/cameras";
import type { Verdict } from "@/stores/case";
import { CropTool } from "./CropTool";
import { useCameraLocation } from "@/stores/floorplan";

interface Props {
  hit: VssHit | undefined;
  onOpenChange: (open: boolean) => void;
  verdict?: Verdict;
  /** Review actions; omitted for read-only playback. */
  onVerdict?: (v: Verdict) => void;
  /**
   * Called with a crop of the frame as a VSS image, to run an image search.
   * Omitted to hide the crop tool (e.g. for a read-only clip).
   */
  onCropSearch?: (image: { previewUrl: string; imageUrl: string }) => void;
}

/** Plays the matched segment (seeks to the best frame) with review shortcuts. */
export function ClipPlayerDialog({
  hit,
  onOpenChange,
  verdict,
  onVerdict,
  onCropSearch,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<CropMedia | null>(null);
  const camera = useCamerasStore(selectCameraByTag(hit?.cameraTag));
  const location = useCameraLocation(hit?.cameraTag, camera?.location);
  const [cropping, setCropping] = useState(false);
  const [saving, setSaving] = useState(false);
  // Synchronous twins of `saving`: a second Enter lands before the re-render,
  // and Back / close during the upload must drop its result.
  const inFlight = useRef(false);
  const attempt = useRef(0);
  const [failedUrl, setFailedUrl] = useState<string>();
  const clipFailed = !!hit?.playbackUrl && failedUrl === hit.playbackUrl;
  const playable = !!hit?.playbackUrl && !clipFailed;
  const at = hit ? hitTime(hit) : undefined;
  const name = hit ? hitCameraLabel(hit) : "";
  const canCrop = !!onCropSearch && !!hit && (playable || !!hit.posterUrl);

  /** Abort the crop and go back to the clip (the dialog stays open). */
  const backToClip = () => {
    attempt.current++;
    inFlight.current = false;
    setCropping(false);
    setSaving(false);
  };

  /** Reset local crop state and close the dialog. */
  const close = () => {
    backToClip();
    onOpenChange(false);
  };

  /** Freeze the frame on screen and open the snipping overlay over it. */
  function startCrop() {
    video.current?.pause();
    // The still (poster) registers itself when it mounts.
    media.current = video.current;
    setCropping(true);
  }

  /** Step the paused clip by roughly one frame to pick a sharper one. */
  function step(dir: 1 | -1) {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, v.currentTime + dir / 25);
  }

  /** Cut the crop out of the frame, save it to VSS and hand it to the caller. */
  async function onCrop(blob: Blob) {
    if (!onCropSearch || inFlight.current) return;
    inFlight.current = true;
    const mine = ++attempt.current;
    setSaving(true);
    try {
      const file = new File([blob], "subject.jpg", { type: "image/jpeg" });
      const { blob: enc, name: fname } = await prepareSearchImage(file);
      const uploaded = await getAdapters().vss.uploadImage(enc, fname);
      if (mine !== attempt.current) return;
      onCropSearch({
        previewUrl: uploaded.previewUrl,
        imageUrl: uploaded.imageUrl,
      });
      close();
    } catch (e) {
      if (mine !== attempt.current) return;
      toast.error("Couldn't save the crop to VSS", {
        description: (e as Error).message,
      });
    } finally {
      if (mine === attempt.current) {
        inFlight.current = false;
        setSaving(false);
      }
    }
  }

  return (
    <Dialog open={!!hit} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-h-[96vh] gap-3 overflow-y-auto p-0 sm:max-w-[min(94vw,1400px)]"
        onEscapeKeyDown={(e) => {
          // Esc leaves the crop first, like a snipping tool.
          if (cropping) {
            e.preventDefault();
            backToClip();
          }
        }}
      >
        {hit && (
          <>
            <div className="relative bg-black">
              {playable && hit.playbackUrl ? (
                <video
                  ref={video}
                  key={hit.playbackUrl}
                  src={withTimeFragment(hit.playbackUrl, hit.startS, hit.endS)}
                  crossOrigin="anonymous"
                  controls={!cropping}
                  autoPlay
                  muted
                  playsInline
                  className="block max-h-[75vh] min-h-[40vh] w-full object-contain"
                  onLoadedMetadata={() => {
                    if (video.current) video.current.currentTime = hit.seekS;
                  }}
                  onError={() => {
                    setFailedUrl(hit.playbackUrl);
                    // Crop from the still instead, if there is one.
                    if (!hit.posterUrl) setCropping(false);
                  }}
                />
              ) : cropping && hit.posterUrl ? (
                <img
                  ref={(el) => {
                    if (el) media.current = el;
                  }}
                  src={hit.posterUrl}
                  crossOrigin="anonymous"
                  alt={`Sighting on ${name}`}
                  draggable={false}
                  className="block max-h-[75vh] w-full object-contain"
                />
              ) : (
                <HitThumb
                  hit={hit}
                  alt={`Sighting on ${name}`}
                  className="w-full"
                >
                  <span className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 text-xs text-white">
                    {clipFailed
                      ? "The clip failed to load"
                      : "Clip playback is not available in mock mode"}
                  </span>
                </HitThumb>
              )}
              {cropping && (
                <CropTool
                  // Remount when the clip fails over to the still.
                  key={`${hit.matchId}:${playable}`}
                  mediaRef={media}
                  saving={saving}
                  onCrop={(b) => void onCrop(b)}
                  onCancel={backToClip}
                />
              )}
            </div>
            <DialogHeader className="px-5">
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {hit.matchId}
                </span>
                {name}
              </DialogTitle>
              <DialogDescription className="font-prose">
                {cropping
                  ? `${clipFailed ? "The clip failed to load, so this is the still frame. " : ""}Drag a rectangle around the person, save the crop to VSS, and Argus searches the footage for that person.`
                  : at
                    ? `${formatDateTime(at)}, ${formatClock(at)}. Segment ${formatOffset(hit.startS)} to ${formatOffset(hit.endS)} of ${hit.videoName ?? hit.videoId}. Relevance ${Math.round(hit.score * 100)}%.${location ? ` Location: ${location}.` : ""}`
                    : `Time unknown. Segment ${formatOffset(hit.startS)} to ${formatOffset(hit.endS)} of ${hit.videoName ?? hit.videoId}. Relevance ${Math.round(hit.score * 100)}%.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="border-t px-5 py-3 sm:justify-between">
              <span className="self-center font-mono text-xs text-muted-foreground">
                {hit.cameraTag}
              </span>
              {cropping ? (
                <div className="flex flex-wrap gap-2">
                  {playable && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => step(-1)}
                        disabled={saving}
                      >
                        <ChevronLeft /> Frame
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => step(1)}
                        disabled={saving}
                      >
                        Frame <ChevronRight />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={backToClip}
                    disabled={saving}
                  >
                    Back to clip
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {canCrop && (
                    <Button variant="outline" size="sm" onClick={startCrop}>
                      <Scissors /> Pause &amp; crop person
                    </Button>
                  )}
                  {onVerdict && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-pressed={verdict === "confirm"}
                      className={cn(
                        verdict === "confirm" &&
                          "border-confirm bg-confirm-soft",
                      )}
                      onClick={() => onVerdict("confirm")}
                    >
                      <Check /> Confirm
                    </Button>
                  )}
                </div>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
