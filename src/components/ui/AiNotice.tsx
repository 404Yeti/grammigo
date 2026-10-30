import Link from "next/link";

/** Shown wherever learner text or voice is about to be sent to an outside AI service. */
export function AiNotice({ what, className }: { what: "voice-and-text" | "writing"; className?: string }) {
  return (
    <p className={`text-xs font-medium leading-4 text-muted ${className ?? ""}`} data-testid="ai-notice">
      {what === "voice-and-text"
        ? "What you type or say here is sent to OpenAI to understand it. "
        : "Your writing is sent to OpenAI to get feedback. "}
      <Link href="/privacy" className="font-semibold underline">
        Privacy details
      </Link>
    </p>
  );
}
