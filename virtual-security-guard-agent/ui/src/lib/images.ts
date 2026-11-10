// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  SEARCH_IMAGE_MAX_BYTES,
  SEARCH_IMAGE_TYPES,
} from "@/adapters/vss/types";

const MAX_EDGE = 1600;

async function reencode(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("Could not encode the image.")),
      "image/jpeg",
      0.88,
    ),
  );
}

/**
 * Validate a reference image for VSS image search. Unsupported formats (other
 * than a few browser-decodable ones) are rejected; oversize images are
 * downscaled to JPEG so they fit the VSS upload limit.
 */
export async function prepareSearchImage(
  file: File,
): Promise<{ blob: Blob; name: string }> {
  if (!file.type.startsWith("image/"))
    throw new Error("Only image files can be used as a search reference.");
  if (
    SEARCH_IMAGE_TYPES.includes(file.type) &&
    file.size <= SEARCH_IMAGE_MAX_BYTES
  )
    return { blob: file, name: file.name };
  if (file.size > 40 * 1024 * 1024)
    throw new Error("That image is too large (over 40 MB).");
  const blob = await reencode(file);
  if (blob.size > SEARCH_IMAGE_MAX_BYTES)
    throw new Error(
      "The image is still over 2 MB after resizing. Try a smaller crop.",
    );
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg" };
}
