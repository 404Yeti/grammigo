import Image from "next/image";
import { MigoVoiceArt } from "./MigoVoiceArt";
import { cn } from "@/lib/utils/cn";

/** Expressions exported from Figma. Expression is chosen from local UI state; no network involved. */
export type MigoExpression =
  | "idle"
  | "happy"
  | "curious"
  | "thinking"
  | "explaining"
  | "encouraging"
  | "celebrating"
  | "listening"
  | "confused"
  | "sleeping";

const ALT: Record<MigoExpression, string> = {
  listening: "Migo, listening",
  confused: "Migo, unsure",
  sleeping: "Migo, sleeping",
  idle: "Migo, waiting",
  happy: "Migo, happy",
  curious: "Migo, curious",
  thinking: "Migo, thinking",
  explaining: "Migo, explaining",
  encouraging: "Migo, winking encouragingly",
  celebrating: "Migo, celebrating",
};

const ANIMATION: Partial<Record<MigoExpression, string>> = {
  idle: "migo-idle",
  happy: "migo-happy",
  curious: "migo-curious",
  encouraging: "migo-encouraging",
  celebrating: "migo-celebrating",
};

interface MigoProps {
  expression?: MigoExpression;
  /** Width in px; height follows the 260 × 300 artboard. */
  size?: number;
  /** Decorative by default: the surrounding text carries the meaning. */
  decorative?: boolean;
  className?: string;
}

export function Migo({ expression = "idle", size = 96, decorative = true, className }: MigoProps) {
  return (
    // key restarts the one-shot animation when the expression changes
    <span
      key={expression}
      className={cn("inline-block shrink-0 pointer-events-none", ANIMATION[expression], className)}
      style={{ width: size, height: (size * 300) / 260 }}
      data-migo={expression}
    >
      {expression === "listening" || expression === "confused" || expression === "sleeping" ? (
        <MigoVoiceArt expression={expression} size={size} label={decorative ? undefined : ALT[expression]} />
      ) : <Image
        src={`/migo/${expression}.svg`}
        alt={decorative ? "" : ALT[expression]}
        width={260}
        height={300}
        unoptimized
        priority={false}
        className="size-full"
      />}
    </span>
  );
}
