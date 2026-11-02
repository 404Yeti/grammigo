import Link from "next/link";
import { ArrowRight, Brain, CloudCheck, Compass, Lightbulb, Map, Smile } from "lucide-react";
import { Migo } from "@/components/mascot/Migo";
import { ButtonLink } from "@/components/ui/Button";
import { GrammarTag } from "@/components/ui/GrammarTag";
import { accountsEnabled } from "@/features/accounts/enabled";
import { ReturningRedirect } from "./ReturningRedirect";
import { SiteFooter } from "./SiteFooter";
import { SiteNav } from "./SiteNav";

const STEPS = [
  { title: "Tell us your goal", body: "Work, study, travel or just everyday English. Pick what matters to you." },
  { title: "Take a short check", body: "An optional five-minute placement. Skip it and we’ll learn as you practice." },
  { title: "Practice what matters", body: "Each session targets the skills you need next, with a reason for every recommendation." },
] as const;

/**
 * Only what the product does today. No claim about speaking, a number of exercise types, pricing or results until those are real
 * (see the marketing test, which fails if such wording appears).
 */
const FEATURES = [
  { icon: Compass, title: "Adaptive practice", body: "Questions adapt to your answers, so you spend time where it helps." },
  { icon: Lightbulb, title: "Explanations that teach", body: "Hints come first, then the rule, then an example, for every question you get wrong." },
  { icon: Brain, title: "Type, build and write", body: "Fill in blanks, fix sentences, put words in order and write short answers of your own." },
  { icon: Map, title: "An honest progress map", body: "Clear evidence for each grammar area. “Not assessed” never means “weak”." },
  { icon: CloudCheck, title: "Your answers stay safe", body: "Answers save on your device first, so a bad connection never loses your work." },
  { icon: Smile, title: "Made to be accessible", body: "Tap or keyboard alternatives to drag, clear focus states and reduced motion." },
] as const;

export function faq(accounts: boolean): { q: string; a: string }[] {
  return [
    { q: "Do I have to take the placement check?", a: "No. It’s optional and skippable. We’ll learn from your practice either way." },
    { q: "Which levels is it for?", a: "Grammar practice from beginner (A1) up to upper-intermediate (B2); the plan adapts to where you are." },
    accounts
      ? { q: "Do I need an account?", a: "No. You can practise right away and your progress stays on your device. Accounts are by invitation for now, and add saving your progress online and picking up on another device." }
      : { q: "Do I need an account?", a: "No. There are no accounts: you can practise right away and your progress stays on your device." },
    { q: "How much does it cost?", a: "Pricing hasn’t been announced yet. We’ll share it before launch." },
    { q: "What happens to my data?", a: accounts ? "You can export or delete it any time. See the Privacy page." : "Your progress stays on your device. See the Privacy page for exactly what is and isn’t sent anywhere." },
  ];
}

const wrap = "mx-auto w-full max-w-[1280px] px-5 lg:px-20";
const card = "rounded-[20px] border border-line bg-surface p-6";

export function MarketingHome() {
  const accounts = accountsEnabled();
  return (
    <div className="bg-canvas text-ink">
      <ReturningRedirect />
      <SiteNav />
      <main>
        <section className={`${wrap} grid items-center gap-10 py-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:py-20`} aria-labelledby="hero-title">
          <div className="flex flex-col items-start gap-5">
            <GrammarTag style="info">Start in a minute · no sign-up needed</GrammarTag>
            <h1 id="hero-title" className="text-balance text-[40px] font-extrabold leading-[1.1] tracking-[-1px] lg:text-[56px]">Better grammar. Your way.</h1>
            <p className="max-w-[560px] text-lg font-medium leading-7 text-ink-2">
              Grammigo is a friendly grammar coach that adapts to what you actually need, so there’s no wasted practice.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <ButtonLink href="/learn" fullWidth={false}>Get started <ArrowRight size={18} aria-hidden /></ButtonLink>
              <ButtonLink href="/#how-it-works" variant="secondary" fullWidth={false}>See how it works</ButtonLink>
            </div>
          </div>
          <div className="flex flex-col items-center gap-5" aria-label="An example of Migo's feedback">
            <Migo expression="explaining" size={176} />
            <div className="w-full max-w-[454px] rounded-[20px] border border-brand bg-brand-soft p-4">
              <p className="text-lg font-bold">“I lived here since 2019.”</p>
              <p className="mt-2 text-base font-medium leading-6 text-ink-2">Close! “Since” points to now, so use the present perfect: “I have lived here since 2019.”</p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-20 border-t border-line bg-subtle py-14 lg:py-24" aria-labelledby="how-title">
          <div className={wrap}>
            <h2 id="how-title" className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">How it works</h2>
            <ol className="mt-8 grid gap-5 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className={card}>
                  <span className="grid size-10 place-items-center rounded-full bg-brand text-base font-extrabold text-ink" aria-hidden>{i + 1}</span>
                  <h3 className="mt-4 text-xl font-bold leading-7">{s.title}</h3>
                  <p className="mt-2 text-base font-medium leading-6 text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="scroll-mt-20 py-14 lg:py-24" aria-labelledby="features-title">
          <div className={wrap}>
            <h2 id="features-title" className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">Built around how you learn</h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className={card}>
                  <Icon size={24} className="text-brand-text" aria-hidden />
                  <h3 className="mt-3 text-xl font-bold leading-7">{title}</h3>
                  <p className="mt-2 text-base font-medium leading-6 text-ink-2">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="about" className="scroll-mt-20 border-t border-line bg-subtle py-14 lg:py-24" aria-labelledby="about-title">
          <div className={`${wrap} flex flex-col items-center gap-8 lg:flex-row lg:gap-12`}>
            <Migo expression="happy" size={150} className="shrink-0" />
            <div>
              <h2 id="about-title" className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">About Grammigo</h2>
              <p className="mt-4 max-w-[760px] text-lg font-medium leading-7 text-ink-2">
                Grammar practice is usually one-size-fits-all. Grammigo starts from you: what you want to say, what you already know, and what to practice next. Migo, our comma-shaped companion, keeps it friendly.
              </p>
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 py-14 lg:py-24" aria-labelledby="faq-title">
          <div className={`${wrap} max-w-[960px]`}>
            <h2 id="faq-title" className="text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">Questions, answered</h2>
            <div className="mt-8 flex flex-col gap-3">
              {faq(accounts).map((f) => (
                <details key={f.q} className="group rounded-[20px] border border-line bg-surface px-5">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-bold">
                    {f.q}
                    <span aria-hidden className="text-2xl font-medium text-muted group-open:rotate-45">+</span>
                  </summary>
                  <p className="pb-5 text-base font-medium leading-6 text-ink-2">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-brand-soft py-14 text-center lg:py-20" aria-labelledby="cta-title">
          <div className={`${wrap} flex flex-col items-center gap-6`}>
            <h2 id="cta-title" className="max-w-[720px] text-[32px] font-extrabold leading-10 tracking-[-0.5px] lg:text-[40px]">Ready for grammar that fits you?</h2>
            <ButtonLink href="/learn" fullWidth={false}>Get started</ButtonLink>
            {accounts && <p className="text-sm font-medium text-ink-2">Already have an account? <Link href="/signin" className="font-bold underline underline-offset-4">Sign in</Link></p>}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
