// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "visibility",
];

/**
 * Serialise a live SVG into a standalone document. Theme colours come from CSS
 * classes and custom properties, which an <img>-loaded SVG cannot see, so the
 * computed values are copied onto each element first.
 */
export function inlineSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const dst = [clone, ...Array.from(clone.querySelectorAll("*"))];
  src.forEach((el, i) => {
    const target = dst[i] as SVGElement | undefined;
    if (!target || !(el instanceof SVGElement)) return;
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => {
      const v = cs.getPropertyValue(p);
      return v ? `${p}:${v}` : "";
    })
      .filter(Boolean)
      .join(";");
    target.setAttribute(
      "style",
      `${target.getAttribute("style") ?? ""};${style}`,
    );
    target.removeAttribute("class");
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

/** Rasterise an on-screen SVG to a PNG data URL (for the PDF report). */
export async function svgToPng(
  svg: SVGSVGElement,
  width = 1600,
): Promise<string> {
  const vb = svg.viewBox.baseVal;
  const ratio = vb && vb.width ? vb.height / vb.width : 0.62;
  const height = Math.round(width * ratio);
  const markup = inlineSvg(svg);
  const url = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml" }),
  );
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render the map image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
