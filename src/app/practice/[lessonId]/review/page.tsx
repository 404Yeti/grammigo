import { notFound } from "next/navigation";
import { getLesson } from "@/data/lessons";
import { ReviewScreen } from "@/features/practice/ReviewScreen";

export default async function ReviewPage({
  params,
  searchParams,
}: PageProps<"/practice/[lessonId]/review">) {
  const { lessonId } = await params;
  const { session } = await searchParams;
  if (!getLesson(lessonId)) notFound();
  return <ReviewScreen lessonId={lessonId} sessionId={typeof session === "string" ? session : undefined} />;
}
