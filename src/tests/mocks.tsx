import type { ReactNode } from "react";
import { vi } from "vitest";
import { router } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
