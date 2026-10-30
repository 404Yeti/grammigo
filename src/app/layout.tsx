import type { Metadata, Viewport } from "next";
import { preload } from "react-dom";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grammigo — Your grammar amigo",
  description: "Short, friendly English grammar practice that adapts to you.",
};

export const viewport: Viewport = {
  themeColor: "#fffdf8",
  width: "device-width",
  initialScale: 1,
};

const MIGO_EXPRESSIONS = ["idle", "thinking", "happy", "encouraging", "curious", "celebrating"];

export default function RootLayout({ children }: LayoutProps<"/">) {
  // Expression changes must be instant: fetch every Migo pose up front so swaps never flash blank.
  MIGO_EXPRESSIONS.forEach((name) => preload(`/migo/${name}.svg`, { as: "image" }));
  return (
    <html lang="en" className="h-full">
      <body className="min-h-dvh font-sans text-ink">{children}</body>
    </html>
  );
}
