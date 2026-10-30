import type { Metadata } from "next";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";

export const metadata: Metadata = { title: "Meet Migo — Grammigo" };

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
