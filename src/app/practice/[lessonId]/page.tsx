import { notFound } from "next/navigation";
import { getLesson, listLessons } from "@/data/lessons";
import { IntroScreen } from "@/features/lessons/IntroScreen";

export function generateStaticParams() {
  return listLessons().map((lesson) => ({ lessonId: lesson.id }));
}

export default async function IntroPage({ params }: PageProps<"/practice/[lessonId]">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return <IntroScreen lessonId={lessonId} />;
}
