import { notFound } from "next/navigation";
import { getLesson, listLessons } from "@/data/lessons";
import { SessionScreen } from "@/features/practice/SessionScreen";

export function generateStaticParams() {
  return listLessons().map((lesson) => ({ lessonId: lesson.id }));
}

export default async function SessionPage({ params }: PageProps<"/practice/[lessonId]/session">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return <SessionScreen lessonId={lessonId} />;
}
