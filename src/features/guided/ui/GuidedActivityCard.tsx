"use client";

import { useSyncExternalStore } from "react";
import { StatTile } from "@/components/progress/StatTile";
import { Card } from "@/components/ui/Card";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { countOutcomes, hasActivity } from "../store/outcome-counts";
import { getGuidedServerSnapshot, getGuidedSnapshot, subscribeGuided } from "../store/store";
import { guidedVisible } from "../visibility";
import { BETA, DASHBOARD } from "./copy";

/**
 * Guided Correction activity on the dashboard: counts of how exercises ended, labelled Beta, provisional and separate from
 * lesson progress. It is NEVER presented as mastery, a skill level or a score, and it is shown only when the activity is visible at all.
 */
export function GuidedActivityCard() {
  const state = useSyncExternalStore(subscribeGuided, getGuidedSnapshot, getGuidedServerSnapshot);
  if (!state || !guidedVisible()) return null;
  const counts = countOutcomes(state);
  if (!hasActivity(counts)) return null;
  const extras = [
    counts.hint_assisted > 0 ? `${counts.hint_assisted} ${DASHBOARD.hint_assisted}` : null,
    counts.shown > 0 ? `${counts.shown} ${DASHBOARD.shown}` : null,
  ].filter(Boolean);
  return (
    <Card className="p-5" aria-labelledby="guided-activity" data-testid="guided-activity">
      <div className="flex items-center justify-between gap-3">
        <h2 id="guided-activity" className="text-xl font-bold leading-7">{DASHBOARD.title}</h2>
        <GrammarTag style="warning">{BETA.label}</GrammarTag>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <StatTile kind="success" value={counts.first_try} label={DASHBOARD.first_try} />
        <StatTile kind="success" value={counts.self_corrected} label={DASHBOARD.self_corrected} />
      </div>
      {extras.length > 0 && <p className="mt-2 text-sm font-medium leading-5 text-ink-2">{DASHBOARD.also} {extras.join(", ")}.</p>}
      <p className="mt-3 text-xs font-medium leading-4 text-muted" data-testid="guided-activity-note">{DASHBOARD.note}</p>
    </Card>
  );
}
