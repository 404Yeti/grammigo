"use client";

import { useSyncExternalStore } from "react";
import type { SyncEngine, SyncStatus } from "./engine";
import { getSyncEngine, getSyncStatus, subscribeSync } from "./runtime";

export const useSyncEngine = (): SyncEngine | null => useSyncExternalStore(subscribeSync, getSyncEngine, () => null);
export const useSyncStatus = (): SyncStatus | null => useSyncExternalStore(subscribeSync, getSyncStatus, () => null);
