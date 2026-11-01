import { GUIDED_STORAGE_KEY } from "@/features/guided/store/schema";
import { isValidScope, scopedKey } from "@/lib/scope/storage-scope";
import { STORAGE_KEY } from "@/lib/storage/schema";

/**
 * After an account is deleted, optionally remove ITS saved progress and sync memory from this device. It touches only the folder of the
 * account that was deleted (named by id): the guest's progress, and any other learner's, are never read, listed or removed.
 * Returns false (and removes nothing it cannot) if storage is unavailable.
 */
export function removeAccountFromDevice(accountId: string): boolean {
  if (!isValidScope(accountId) || accountId === "") return false;
  try {
    for (const key of [scopedKey(STORAGE_KEY, accountId), scopedKey(GUIDED_STORAGE_KEY, accountId), `grammigo:sync:v1:u:${accountId}`]) window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
