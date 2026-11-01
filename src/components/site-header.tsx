import Link from "next/link";
import { signOut, startDemo } from "@/app/actions/session";
import { unreadForOwner } from "@/lib/notify";
import { getCurrentUser } from "@/lib/session";
import { Logo } from "./logo";
import { Button, Container } from "./ui";

/** Always on screen: this runs on the PayPal sandbox, so nothing here is real money. */
function SandboxPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-held-fill/40 bg-held-soft px-2.5 py-1 text-xs font-medium text-held"
      title="PayPal sandbox. No real money moves. Every payment here is a test transaction."
    >
      <span className="size-1.5 rounded-full bg-held-fill" aria-hidden="true" />
      <span>
        Sandbox<span className="hidden sm:inline"> · no real money</span>
      </span>
    </span>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  const unread = user ? [...(await unreadForOwner(user.id).catch(() => new Map<string, number>())).values()].reduce((a, b) => a + b, 0) : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Logo />
          <SandboxPill />
          <nav className="hidden items-center gap-1 text-sm md:flex">
            <Link href="/#how-it-works" className="rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              How it works
            </Link>
            {user && (
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
                Dashboard
                {unread > 0 && (
                  <span className="tabular rounded-full bg-brand px-1.5 text-xs font-medium text-brand-ink" aria-label={`${unread} new notices`}>
                    {unread}
                  </span>
                )}
              </Link>
            )}
          </nav>
        </div>
        {user ? (
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/dashboard" className="text-sm md:hidden" aria-label="Dashboard">
              <span className="text-muted">Jobs</span>
              {unread > 0 && <span className="tabular ml-1.5 rounded-full bg-brand px-1.5 text-xs font-medium text-brand-ink">{unread}</span>}
            </Link>
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-muted">{user.demo ? "Freelancer · demo" : "Freelancer"}</div>
            </div>
            <form action={signOut}>
              <Button variant="secondary" size="sm" type="submit">
                {user.demo ? "End demo" : "Sign out"}
              </Button>
            </form>
          </div>
        ) : (
          <form action={startDemo} className="shrink-0">
            <Button size="sm" type="submit">
              Try the demo
            </Button>
          </form>
        )}
      </Container>
    </header>
  );
}
