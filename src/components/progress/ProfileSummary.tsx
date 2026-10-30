import { Check, CircleDashed, RotateCcw, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import type { LearningProfile, ProfileEntry } from "@/features/learning/profile";
import { cn } from "@/lib/utils/cn";

function Group({
  title,
  icon,
  tone,
  entries,
  testId,
  limit = 5,
}: {
  title: string;
  icon: ReactNode;
  tone: string;
  entries: ProfileEntry[];
  testId: string;
  limit?: number;
}) {
  if (entries.length === 0) return null;
  const shown = entries.slice(0, limit);
  return (
    <section className={cn("rounded-[20px] border p-4", tone)} data-testid={testId} aria-label={title}>
      <h3 className="flex items-center gap-2 text-base font-bold leading-6">
        {icon} {title}
      </h3>
      <ul className="mt-2 space-y-2">
        {shown.map((e) => (
          <li key={e.skillId} className="text-sm font-medium leading-5">
            <span className="font-semibold">{e.title}</span>
            {e.isGoal && <span className="ml-2 rounded-full bg-surface/70 px-2 py-0.5 text-xs font-bold text-brand-text">You mentioned this</span>}
            <span className="block text-ink-2">{e.note}</span>
          </li>
        ))}
      </ul>
      {entries.length > shown.length && (
        <p className="mt-2 text-xs font-medium text-muted">+ {entries.length - shown.length} more</p>
      )}
    </section>
  );
}

/**
 * A provisional skill profile: strengths, areas to work on, in progress and not-yet-checked.
 * Always carries the caveat that it is not a CEFR level and rests on limited evidence.
 */
export function ProfileSummary({ profile }: { profile: LearningProfile }) {
  return (
    <div className="flex flex-col gap-3" data-testid="profile">
      <p className="text-base font-medium leading-6 text-ink-2" data-testid="profile-headline">
        {profile.headline}
      </p>
      <Group
        title="Looks like strengths"
        icon={<Check size={18} className="text-success" aria-hidden />}
        tone="border-success-border bg-success-soft"
        entries={profile.strengths}
        testId="profile-strengths"
      />
      <Group
        title="Worth working on"
        icon={<RotateCcw size={17} aria-hidden />}
        tone="border-transparent bg-warning-soft"
        entries={profile.weaknesses}
        testId="profile-weaknesses"
      />
      <Group
        title="In progress"
        icon={<TrendingUp size={17} aria-hidden />}
        tone="border-info-border bg-info-soft"
        entries={profile.inProgress}
        testId="profile-in-progress"
        limit={3}
      />
      <section className="rounded-[20px] border border-line bg-subtle p-4" data-testid="profile-unassessed">
        <h3 className="flex items-center gap-2 text-base font-bold leading-6">
          <CircleDashed size={17} aria-hidden /> Not checked yet ({profile.unassessed.length})
        </h3>
        <p className="mt-1 text-sm font-medium leading-5 text-ink-2">
          That doesn’t mean they’re weak. We just don’t have evidence yet.
        </p>
      </section>
      {profile.mixedLevel && (
        <p className="rounded-2xl bg-brand-soft p-3 text-sm font-medium leading-5" data-testid="profile-mixed">
          You’re stronger in some areas than others, which is very common. We’ll fix the gaps first, so the harder
          topics feel easier.
        </p>
      )}
      <p className="text-xs font-medium leading-4 text-muted" data-testid="profile-caveat">
        {profile.caveat}
      </p>
    </div>
  );
}
