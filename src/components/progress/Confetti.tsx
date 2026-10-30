const PIECES: { x: number; y: number; w: number; h: number; r: number; c: string; delay: number }[] = [
  { x: 6, y: 4, w: 14, h: 8, r: 20, c: "#a7b9a0", delay: 0 },
  { x: 28, y: 2, w: 10, h: 10, r: 0, c: "#ff7316", delay: 40 },
  { x: 82, y: 3, w: 12, h: 12, r: 0, c: "#ff7316", delay: 80 },
  { x: 92, y: 12, w: 8, h: 8, r: 0, c: "#e7e0d0", delay: 120 },
  { x: 4, y: 14, w: 16, h: 6, r: -30, c: "#ff7316", delay: 60 },
  { x: 16, y: 22, w: 8, h: 14, r: 15, c: "#ff9a55", delay: 100 },
  { x: 90, y: 22, w: 10, h: 10, r: 0, c: "#a7b9a0", delay: 140 },
  { x: 74, y: 8, w: 30, h: 8, r: 55, c: "#ff7316", delay: 20 },
  { x: 8, y: 30, w: 8, h: 8, r: 0, c: "#a7b9a0", delay: 160 },
  { x: 94, y: 30, w: 14, h: 6, r: -20, c: "#ff9a55", delay: 90 },
  { x: 36, y: 26, w: 6, h: 14, r: 40, c: "#e7e0d0", delay: 110 },
  { x: 62, y: 28, w: 12, h: 12, r: 0, c: "#ff7316", delay: 70 },
];

/** Decorative only: hidden from assistive tech, static under prefers-reduced-motion. */
export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[340px] overflow-hidden">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="confetti-piece absolute"
          style={{
            left: `${p.x}%`,
            top: `${p.y * 3}px`,
            width: p.w,
            height: p.h,
            background: p.c,
            borderRadius: p.w === p.h ? "9999px" : 3,
            transform: `rotate(${p.r}deg)`,
            animationDelay: `${p.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}
