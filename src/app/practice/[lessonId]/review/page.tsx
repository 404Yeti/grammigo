import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLesson, listLessons } from "@/data/lessons";
import { ReviewScreen } from "@/features/practice/ReviewScreen";

export function generateStaticParams() {
  return listLessons().map((lesson) => ({ lessonId: lesson.id }));
}

export default async function ReviewPage({ params }: PageProps<"/practice/[lessonId]/review">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return (
    <Suspense fallback={<div className="min-h-dvh" aria-busy="true" />}>
      <ReviewScreen lessonId={lessonId} />
    </Suspense>
  );
}
