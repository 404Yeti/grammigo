import type { Metadata } from "next";
import { SiteNav } from "@/features/marketing/SiteNav";
import { SiteFooter } from "@/features/marketing/SiteFooter";
import { ContactForm } from "@/features/marketing/ContactForm";

export const metadata: Metadata = { title: "Contact — Grammigo", description: "Questions, feedback or a problem? Contact Grammigo." };

export default function ContactPage() {
  const address = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim();
  const email = address && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(address) ? address : null;
  return (
    <div className="bg-canvas text-ink">
      <SiteNav />
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-5 pt-12 pb-24 lg:pt-16">
        <h1 className="text-[44px] font-extrabold leading-[52px] tracking-[-1px] lg:text-[56px] lg:leading-[64px]">Contact us</h1>
        <p className="text-lg font-medium leading-7 text-ink-2">Questions, feedback or a problem? We’d love to hear from you.</p>
        <ContactForm email={email} />
      </main>
      <SiteFooter />
    </div>
  );
}
