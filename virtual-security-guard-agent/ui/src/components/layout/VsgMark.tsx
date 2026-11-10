// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { cn } from "@/lib/utils";

/**
 * VSG mark: a shield with an eye, on the Intel classic-blue square. While a
 * live search runs (`watching`) the eye scans left and right and blinks.
 */
export function VsgMark({
  className,
  watching,
}: {
  className?: string;
  watching?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
    >
      <rect
        width="32"
        height="32"
        className="fill-[var(--classic-blue)] dark:fill-[var(--energy-blue)]"
      />
      <path
        d="M16 6 L25 9.5 V16 C25 21.2 21.2 24.8 16 26.5 C10.8 24.8 7 21.2 7 16 V9.5 Z"
        className="stroke-white dark:stroke-[var(--classic-blue-shade-2)]"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <g className={cn(watching && "vsg-eye-blink")}>
        <path
          d="M10.5 16 C12.2 13 14 11.8 16 11.8 C18 11.8 19.8 13 21.5 16 C19.8 19 18 20.2 16 20.2 C14 20.2 12.2 19 10.5 16 Z"
          className="stroke-white dark:stroke-[var(--classic-blue-shade-2)]"
          strokeWidth="1.4"
        />
        <circle
          cx="16"
          cy="16"
          r="2.6"
          className={cn(
            "fill-[var(--energy-blue)] dark:fill-[var(--classic-blue-shade-2)]",
            watching && "vsg-eye-scan",
          )}
        />
      </g>
    </svg>
  );
}
