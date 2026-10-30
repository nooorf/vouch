import { startDemo } from "@/app/actions/session";
import { MoneyBar } from "@/components/money-bar";
import { Badge, Button, Card, Container, LinkButton } from "@/components/ui";
import { demoBrief } from "@/lib/brief/demo";
import { formatCents } from "@/lib/money";

/** Example states for the hero preview, built from the real demo brief. */
const preview = [
  { status: "Released", tone: "brand" as const, released: 15000, note: "All 5 checks passed" },
  { status: "Partial", tone: "held" as const, released: 9000, note: "2 fixes: viewport tag, image alt text" },
  { status: "Held", tone: "neutral" as const, released: 0, note: "Waiting for delivery" },
];

function HeroPreview() {
  const released = preview.reduce((s, p) => s + p.released, 0);
  return (
    <Card className="p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.18)] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Job</p>
          <h3 className="mt-1 truncate font-semibold">{demoBrief.title}</h3>
        </div>
        <span className="tabular shrink-0 font-mono text-lg font-semibold">{formatCents(demoBrief.totalCents)}</span>
      </div>
      <div className="mt-5">
        <MoneyBar totalCents={demoBrief.totalCents} authorizedCents={demoBrief.totalCents} releasedCents={released} />
      </div>
      <ul className="mt-5 divide-y divide-line border-t border-line">
        {demoBrief.milestones.map((m, i) => (
          <li key={m.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                <span className="text-muted">M{i + 1}</span> {m.title}
              </p>
              <p className="truncate text-xs text-muted">{preview[i].note}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="tabular font-mono text-sm text-muted">
                {formatCents(preview[i].released)}
                <span className="hidden sm:inline"> / {formatCents(m.amountCents)}</span>
              </span>
              <Badge tone={preview[i].tone}>{preview[i].status}</Badge>
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
      <section className="border-b border-line">
        <Container className="grid grid-cols-1 items-center gap-12 py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:py-24">
          <div>
            {needsSignIn && (
              <p className="mb-6 rounded-lg border border-line bg-info-soft px-4 py-3 text-sm text-info">
                Start the demo to open your workspace.
              </p>
            )}
            <Badge tone="brand">Pay-on-proof for freelance work</Badge>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              The money waits until the work is proven.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-pretty text-muted">
              Vouch holds the client&apos;s payment in PayPal, checks each delivery against the agreed brief, and
              releases money milestone by milestone, with the evidence on screen for both sides.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <form action={startDemo}>
                <Button size="lg" type="submit">
                  Try the demo
                </Button>
              </form>
              <LinkButton href="#how-it-works" variant="secondary" size="lg">
                How it works
              </LinkButton>
            </div>
            <p className="mt-4 text-sm text-muted">No sign-up. The demo opens a private sandbox workspace.</p>
          </div>
          <HeroPreview />
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-8 border-b border-line">
        <Container className="py-16 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">How it works</h2>
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title}>
                <span className="tabular flex size-8 items-center justify-center rounded-full bg-brand-soft font-mono text-sm font-semibold text-brand">
                  {i + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section>
        <Container className="py-16 lg:py-20">
          <div className="grid gap-4 md:grid-cols-3">
            {principles.map((p) => (
              <Card key={p.who} className="p-6">
                <h3 className="font-semibold">{p.who}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
