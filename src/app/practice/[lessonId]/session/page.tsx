import { notFound } from "next/navigation";
import { getLesson } from "@/data/lessons";
import { SessionScreen } from "@/features/practice/SessionScreen";

export default async function SessionPage({ params }: PageProps<"/practice/[lessonId]/session">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return <SessionScreen lessonId={lessonId} />;
}
