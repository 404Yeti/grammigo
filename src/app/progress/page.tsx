import type { Metadata } from "next";
import { ProgressScreen } from "@/features/progress/ProgressScreen";

export const metadata: Metadata = { title: "Your progress — Grammigo" };

export default function ProgressPage() {
  return <ProgressScreen />;
}
