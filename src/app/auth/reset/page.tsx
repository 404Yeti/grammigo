import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthShell } from "@/features/accounts/AuthShell";
import { accountsEnabled } from "@/features/accounts/enabled";
import { ResetForm } from "@/features/accounts/ResetForm";

export const metadata: Metadata = { title: "Reset your password — Grammigo", robots: { index: false, follow: false }, referrer: "same-origin" };

// The link in the password-reset email lands here with the one-time token in the URL FRAGMENT (never sent to the server, so not in request logs).
// The referrer policy is same-origin, NOT no-referrer: with no-referrer a browser sends "Origin: null" on the form post and the server rightly refuses it.
// Opening this page changes nothing; the button posts the token. It works in any browser or on any device.
export default function ResetPage() {
  if (!accountsEnabled()) notFound();
  return (
    <AuthShell title="Reset your password">
      <ResetForm />
    </AuthShell>
  );
}
