import { notFound } from "next/navigation";
import { getLesson } from "@/data/lessons";
import { IntroScreen } from "@/features/lessons/IntroScreen";

export default async function IntroPage({ params }: PageProps<"/practice/[lessonId]">) {
  const { lessonId } = await params;
  if (!getLesson(lessonId)) notFound();
  return <IntroScreen lessonId={lessonId} />;
}
