// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { toast } from "sonner";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

const QUOTA_TOAST_ID = "vsg-storage-full";

/**
 * localStorage for zustand persist that never throws on write. A full quota
 * would otherwise throw out of `set()` after the in-memory update; the state
 * stays usable in this tab and the operator is told it won't survive a reload.
 */
const safeLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      toast.error("Browser storage is full", {
        id: QUOTA_TOAST_ID,
        description: `Recent changes won't survive a reload (${(e as Error).name}). Clear local data in Settings.`,
      });
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
};

export const persistStorage = <S>() =>
  createJSONStorage<S>(() => safeLocalStorage);
