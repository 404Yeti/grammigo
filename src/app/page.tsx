import type { Metadata } from "next";
import { MarketingHome } from "@/features/marketing/MarketingHome";

export const metadata: Metadata = {
  title: "Grammigo — Your grammar amigo",
  description: "Friendly English grammar practice that adapts to what you need. Start in a minute, no sign-up.",
};

/** The public front page. The learner's home is /learn. */
export default function Home() {
  return <MarketingHome />;
}
