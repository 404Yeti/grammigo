import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-dvh font-sans text-ink">{children}</body>
    </html>
  );
}
