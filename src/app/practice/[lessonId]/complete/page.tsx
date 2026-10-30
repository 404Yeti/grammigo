import { notFound } from "next/navigation";
import { getLesson } from "@/data/lessons";
import { CompleteScreen } from "@/features/practice/CompleteScreen";

export default async function CompletePage({
  params,
  searchParams,
}: PageProps<"/practice/[lessonId]/complete">) {
  const { lessonId } = await params;
  const { session } = await searchParams;
  if (!getLesson(lessonId)) notFound();
  return <CompleteScreen lessonId={lessonId} sessionId={typeof session === "string" ? session : undefined} />;
}
