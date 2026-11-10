// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown in place of a page that failed to render. Inside the shell the
 * navigation stays usable; a reload starts the app fresh.
 */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div
      role="alert"
      className="mx-auto grid w-full max-w-xl gap-3 p-6 text-sm"
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <TriangleAlert className="size-5 text-destructive" />
        This page stopped working
      </h2>
      <p className="text-muted-foreground">
        Investigations are kept in Hermes, so reloading loses nothing that was
        saved.
      </p>
      <pre className="overflow-auto border bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap">
        {message}
      </pre>
      <div>
        <Button size="sm" onClick={() => window.location.reload()}>
          <RotateCcw /> Reload
        </Button>
      </div>
    </div>
  );
}

/** An address that isn't a VSG page. */
export function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-3 p-6 text-sm">
      <h2 className="text-lg font-semibold">Page not found</h2>
      <p className="text-muted-foreground">
        There is no page at this address.{" "}
        <Link to="/argus" className="text-brand-accent hover:underline">
          Go to Argus
        </Link>
        .
      </p>
    </div>
  );
}
