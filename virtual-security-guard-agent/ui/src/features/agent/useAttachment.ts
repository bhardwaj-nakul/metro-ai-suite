// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from "react";
import { getAdapters } from "@/adapters";
import type { UploadedImage } from "@/adapters/vss/types";
import { prepareSearchImage } from "@/lib/images";

export type Attachment =
  | { status: "uploading"; localUrl: string; name: string }
  | { status: "ready"; localUrl: string; name: string; uploaded: UploadedImage }
  | { status: "error"; localUrl?: string; name: string; error: string };

/**
 * Reference image for the next search. The image is validated and uploaded to
 * VSS as soon as it is attached, so sending is instant and Argus only ever
 * receives the VSS imageUrl.
 */
export function useAttachment() {
  const [attachment, setAttachment] = useState<Attachment>();
  const token = useRef(0);

  const revoke = (a?: Attachment) => {
    if (a?.localUrl) URL.revokeObjectURL(a.localUrl);
  };

  const clear = useCallback(() => {
    token.current++;
    setAttachment((prev) => {
      revoke(prev);
      return undefined;
    });
  }, []);

  const attach = useCallback(async (file: File) => {
    const mine = ++token.current;
    const localUrl = URL.createObjectURL(file);
    setAttachment((prev) => {
      revoke(prev);
      return { status: "uploading", localUrl, name: file.name };
    });
    try {
      const { blob, name } = await prepareSearchImage(file);
      const uploaded = await getAdapters().vss.uploadImage(blob, name);
      if (token.current === mine)
        setAttachment({ status: "ready", localUrl, name: file.name, uploaded });
    } catch (e) {
      if (token.current === mine)
        setAttachment({
          status: "error",
          localUrl,
          name: file.name,
          error: (e as Error).message || "Upload failed.",
        });
    }
  }, []);

  /** Hand the uploaded image to the transcript; keeps the local preview alive. */
  const take = useCallback((): UploadedImage | undefined => {
    if (attachment?.status !== "ready") return undefined;
    token.current++;
    setAttachment(undefined);
    return { ...attachment.uploaded, previewUrl: attachment.localUrl };
  }, [attachment]);

  useEffect(
    () => () => {
      token.current++;
    },
    [],
  );

  return { attachment, attach, clear, take };
}

export function firstImageFile(
  list: FileList | DataTransferItemList | null | undefined,
): File | undefined {
  if (!list) return undefined;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const file =
      item instanceof File
        ? item
        : item.kind === "file"
          ? item.getAsFile()
          : null;
    if (file && file.type.startsWith("image/")) return file;
  }
  return undefined;
}
