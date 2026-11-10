// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";
import { matchPath, Outlet, useLocation } from "react-router";
import { ChevronRight, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { keepAliveRoutes, navItems } from "@/config/navigation";
import { AgentHub } from "@/features/agent/AgentHub";
import { toast } from "sonner";
import { useCamerasStore } from "@/stores/cameras";
import { useFloorplanStore } from "@/stores/floorplan";
import { useInvestigationStore } from "@/stores/investigation";
import { Navigation } from "./Navigation";

const keepAlive: Record<string, () => React.ReactElement> = {
  "/argus": () => <AgentHub />,
};

function usePageTitle() {
  const { pathname } = useLocation();
  return navItems.find((i) => pathname.startsWith(i.url))?.pageTitle ?? "";
}

/** ViPPET-style shell: icon-collapsible sidebar, 60px header, content area. */
export function AppShell() {
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  const title = usePageTitle();
  const investigation = useInvestigationStore((s) => s.title);
  const onArgus = !!matchPath({ path: "/argus", end: true }, pathname);
  const loadCameras = useCamerasStore((s) => s.load);

  useEffect(() => {
    void loadCameras();
  }, [loadCameras]);

  const discardedUpload = useFloorplanStore((s) => s.discardedUpload);
  useEffect(() => {
    if (!discardedUpload) return;
    toast.warning("Saved floorplan is no longer valid, using the default", {
      description: discardedUpload,
    });
    useFloorplanStore.setState({ discardedUpload: undefined });
  }, [discardedUpload]);

  useEffect(() => {
    document.title = title
      ? `${title} | Virtual Security Guard Agent`
      : "Virtual Security Guard Agent";
  }, [title]);

  const onKeepAlive = keepAliveRoutes.some((p) =>
    matchPath({ path: p, end: true }, pathname),
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col">
        <SidebarProvider>
          <Navigation />
          <SidebarInset className="min-w-0">
            <header className="flex h-[60px] shrink-0 items-center justify-between gap-2 border-b">
              <div className="flex min-w-0 items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mr-2 data-[orientation=vertical]:h-4"
                />
                <h1 className="flex min-w-0 items-center gap-1.5 text-lg font-semibold">
                  <span className="shrink-0">{title}</span>
                  {onArgus && (
                    <>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span
                        className="truncate text-base font-normal text-muted-foreground"
                        title={investigation}
                      >
                        {investigation ?? "New investigation"}
                      </span>
                    </>
                  )}
                </h1>
              </div>
              <div className="flex items-center gap-2 px-4">
                <Button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label="Toggle theme"
                  variant="ghost"
                  size="icon"
                >
                  {theme === "dark" ? (
                    <Sun className="size-5" />
                  ) : (
                    <Moon className="size-5" />
                  )}
                </Button>
              </div>
            </header>
            <main className="relative flex min-h-0 flex-1 overflow-hidden">
              {keepAliveRoutes.map((p) => {
                const active = !!matchPath({ path: p, end: true }, pathname);
                return (
                  <div key={p} className="h-full w-full" hidden={!active}>
                    {keepAlive[p]?.()}
                  </div>
                );
              })}
              {!onKeepAlive && (
                <div className="h-full w-full overflow-auto">
                  <Outlet />
                </div>
              )}
            </main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster position="top-center" richColors />
      </div>
    </TooltipProvider>
  );
}
