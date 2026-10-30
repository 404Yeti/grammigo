import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLesson, listLessons } from "@/data/lessons";
import { CompleteScreen } from "@/features/practice/CompleteScreen";

export function generateStaticParams() {
  return listLessons().map((lesson) => ({ lessonId: lesson.id }));
}

export default async function CompletePage({ params }: PageProps<"/practice/[lessonId]/complete">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
      <CompleteScreen lessonId={lessonId} />
    </Suspense>
  );
}
