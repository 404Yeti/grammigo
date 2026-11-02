"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Someone who has already used Grammigo on this device (practice saved here, or an account session) and opens the bare address, perhaps from an old
 * bookmark, goes straight back to their learning home. A first-time visitor, and anyone without script (search engines included), simply sees the page.
 */
export function hasUsedGrammigoHere(storage: Pick<Storage, "length" | "key">, cookie: string): boolean {
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i) ?? "";
    if (k.startsWith("grammigo:v") && !k.endsWith(":corrupt")) return true;
  }
  return /(?:^|;\s*)(?:__Host-)?gm-scope=/.test(cookie);
}

export function ReturningRedirect() {
  const router = useRouter();
  useEffect(() => {
    try {
      if (window.location.hash) return;
      if (hasUsedGrammigoHere(window.localStorage, document.cookie)) router.replace("/learn");
    } catch {
      // storage blocked: show the page
    }
  }, [router]);
  return null;
}
