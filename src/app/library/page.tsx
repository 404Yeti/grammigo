import type { Metadata } from "next";
import { LibraryScreen } from "@/features/lessons/LibraryScreen";

export const metadata: Metadata = { title: "Grammar library — Grammigo" };

export default function LibraryPage() {
  return <LibraryScreen />;
}
