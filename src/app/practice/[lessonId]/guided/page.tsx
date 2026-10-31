import { notFound } from "next/navigation";
import { GUIDED_SKILL_ID } from "@/curriculum/guided";
import { guidedVisible } from "@/features/guided/visibility";
import { GuidedScreen } from "@/features/guided/ui/GuidedScreen";

export function generateStaticParams() {
  return [{ lessonId: GUIDED_SKILL_ID }];
}

export default async function GuidedPage({ params }: PageProps<"/practice/[lessonId]/guided">) {
  const { lessonId } = await params;
  if (lessonId !== GUIDED_SKILL_ID || !guidedVisible()) notFound();
  return <GuidedScreen lessonId={lessonId} />;
}
