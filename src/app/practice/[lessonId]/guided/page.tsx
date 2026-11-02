import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { requireLearner } from "@/lib/auth/page";
import { GUIDED_SKILL_ID } from "@/curriculum/guided";
import { guidedOwnerPreviewRequested, guidedPublicPreview } from "@/features/guided/visibility";
import { GuidedScreen } from "@/features/guided/ui/GuidedScreen";

export function generateStaticParams() {
  return [{ lessonId: GUIDED_SKILL_ID }];
}

export default async function GuidedPage({ params }: PageProps<"/practice/[lessonId]/guided">) {
  const { lessonId } = await params;
  if (lessonId !== GUIDED_SKILL_ID) notFound();
  return <Suspense fallback={null}><Access lessonId={lessonId} /></Suspense>;
}

async function Access({ lessonId }: { lessonId: string }) {
  await connection();
  if (!guidedPublicPreview()) {
    if (!guidedOwnerPreviewRequested()) notFound();
    await requireLearner({ admin: true });
  }
  return <GuidedScreen lessonId={lessonId} />;
}
