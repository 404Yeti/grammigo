/** Original Figma vector layers, placed using their design bounds including stroke extents. */
export type VoiceExpression = "listening" | "confused" | "sleeping";
type Layer = readonly [name: string, x: number, y: number, width: number, height: number];
const COMMON: readonly Layer[] = [
  ["body", 32, 50, 176, 237.632],
  ["mustache", 49.1470375, 162.930542, 141.706, 39.0695],
];
const LAYERS: Record<VoiceExpression, readonly Layer[]> = {
  listening: [
    COMMON[0], ["brows", 62.5, 77.5, 107.001, 20.0002], ["eyes", 72, 105, 90, 46],
    COMMON[1], ["marks", 213.5, 83.5, 36.0008, 97.002],
  ],
  confused: [
    COMMON[0], ["brows", 62.5, 80.2777786, 107.001, 29.2238], ["eyes", 76, 105, 86, 43],
    COMMON[1], ["marks", 145.5, 25.5, 69.0012, 25],
  ],
  sleeping: [
    COMMON[0], ["brows", 64.5, 98.5, 103.002, 13.0008], ["eyes", 67.5, 124.5, 99, 16.5],
    COMMON[1], ["marks", 186, 34.5, 54.5001, 71.5],
  ],
};

/** The artwork stays transparent; Figma's gray component presentation background is not an asset. */
export function MigoVoiceArt({ expression, size, label }: { expression: VoiceExpression; size: number; label?: string }) {
  return (
    <svg width={size} height={size * 300 / 260} viewBox="0 0 260 300" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {LAYERS[expression].map(([name, x, y, width, height]) => <image key={name} href={`/migo/${expression}/${name}.svg`} x={x} y={y} width={width} height={height} />)}
    </svg>
  );
}
