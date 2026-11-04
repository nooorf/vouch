import { startDemo } from "@/app/actions/session";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Button, Callout, Card, Container, LinkButton } from "@/components/ui";
import { demoBrief } from "@/lib/brief/demo";
import { formatCents } from "@/lib/money";

/** Example states for the hero preview, built from the real demo brief. */
const preview = [
  { status: "Released", tone: "ok" as const, released: 15000, note: "All 5 checks passed" },
  { status: "Partial", tone: "held" as const, released: 9000, note: "2 fixes: image alt text, accessibility score" },
  { status: "Held", tone: "neutral" as const, released: 0, note: "Waiting for delivery" },
];

function HeroPreview() {
  const released = preview.reduce((s, p) => s + p.released, 0);
  return (
    <Card className="p-6 shadow-raised sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted">Example job</p>
          <h3 className="mt-1 truncate font-semibold">{demoBrief.title}</h3>
        </div>
        <span className="amount shrink-0 text-2xl font-semibold">{formatCents(demoBrief.totalCents)}</span>
      </div>
      <div className="mt-6">
        <MoneyBar totalCents={demoBrief.totalCents} authorizedCents={demoBrief.totalCents} releasedCents={released} size="lg" />
      </div>
      <ul className="mt-6 divide-y divide-line border-t border-line">
        {demoBrief.milestones.map((m, i) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-3.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.title}</p>
              <p className="truncate text-xs text-muted">{preview[i].note}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="amount text-sm text-muted">
                {formatCents(preview[i].released)}
                <span className="hidden text-faint sm:inline"> / {formatCents(m.amountCents)}</span>
              </span>
              <Badge tone={preview[i].tone} dot>
                {preview[i].status}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const steps = [
  {
    title: "Agree a brief you can check",
    body: "Describe the job in plain words. AI drafts milestones with measurable acceptance criteria. Both sides accept the exact same version before any money moves.",
  },
  {
    title: "Client funds it with PayPal",
    body: "The client pays through PayPal, but the payment is only authorized: the money is held, not sent. Nobody can spend it yet.",
  },
  {
    title: "Each delivery is checked",
    body: "Measured checks (Lighthouse scores, page structure, CI status) run first. Then AI judges the subjective criteria and must quote evidence from the page.",
  },
  {
    title: "Money is released on proof",
    body: "A fixed policy captures what was earned: all of it, part of it, or nothing, with a fix list. The client can approve, dispute or override at any time.",
  },
];

const principles = [
  { who: "The AI proposes", body: "It drafts briefs and judges subjective criteria. It never moves money and can't override a failed measured check." },
  { who: "The policy decides", body: "Plain code turns the verdict into an amount, never above what the client authorized. Same inputs, same result." },
  { who: "A human can override", body: "The client can approve, dispute or decide at any point. Every action lands in an audit ledger." },
];

export default async function Home(props: PageProps<"/">) {
  const params = await props.searchParams;
  const needsSignIn = params.signin === "required";

  return (
    <>
      <section>
        <Container className="grid grid-cols-1 items-center gap-14 pt-14 pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-24 lg:pb-28">
          <div>
            {needsSignIn && <Callout tone="info" className="mb-8">Start the demo to open your workspace.</Callout>}
            <h1 className="text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-6xl">The money waits until the work is proven.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted">
              Vouch holds the client&apos;s payment in PayPal, checks each freelance delivery against the agreed brief, and releases money milestone by
              milestone, with the evidence on screen for both sides.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <form action={startDemo}>
                <Button size="lg" type="submit">
                  Try the demo
                </Button>
              </form>
              <LinkButton href="#how-it-works" variant="secondary" size="lg">
                How it works
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-faint">No sign-up. The demo opens a private sandbox workspace.</p>
          </div>
          <HeroPreview />
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-line">
        <Container className="py-20 lg:py-28">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold sm:text-4xl">How it works</h2>
            <p className="mt-4 text-lg text-pretty text-muted">Four steps, and both sides see the same screen at every one of them.</p>
          </div>
          <ol className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title} className="border-t border-line-strong pt-6">
                <span className="tabular text-sm font-semibold text-brand">Step {i + 1}</span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-t border-line bg-surface">
        <Container className="py-20 lg:py-28">
          <h2 className="max-w-2xl text-3xl font-semibold text-balance sm:text-4xl">AI helps. It never holds the money.</h2>
          <div className="mt-14 grid gap-x-10 gap-y-10 md:grid-cols-3">
            {principles.map((p) => (
              <div key={p.who}>
                <h3 className="text-lg font-semibold">{p.who}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-pretty text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
