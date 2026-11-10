// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import {
  Cctv,
  FileText,
  Map,
  ScanEye,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  /** Header title for the page. */
  pageTitle: string;
}

export const navItems: NavItem[] = [
  { title: "Argus", url: "/argus", icon: ScanEye, pageTitle: "Argus" },
  {
    title: "Live cameras",
    url: "/cameras",
    icon: Cctv,
    pageTitle: "Live cameras",
  },
  { title: "Floorplan", url: "/floorplan", icon: Map, pageTitle: "Floorplan" },
  { title: "Reports", url: "/reports", icon: FileText, pageTitle: "Reports" },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
    pageTitle: "Settings",
  },
];

/** Routes kept mounted while hidden so a running investigation keeps its scroll and media. */
export const keepAliveRoutes = ["/argus"];
