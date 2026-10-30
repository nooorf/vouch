import Link from "next/link";
import { signOut, startDemo } from "@/app/actions/session";
import { getCurrentUser } from "@/lib/session";
import { Logo } from "./logo";
import { Badge, Button, Container } from "./ui";

export function SandboxBanner() {
  return (
    <div className="border-b border-line bg-held-soft text-center text-xs text-held">
      <Container className="py-1.5">
        <strong className="font-semibold">PayPal sandbox.</strong> No real money moves. Every payment here is a test transaction.
      </Container>
    </div>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            <Link href="/#how-it-works" className="rounded-md px-3 py-2 text-muted hover:text-ink">
              How it works
            </Link>
            {user && (
              <Link href="/dashboard" className="rounded-md px-3 py-2 text-muted hover:text-ink">
                Dashboard
              </Link>
            )}
          </nav>
        </div>
        {user ? (
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm leading-tight sm:block">
              <div className="font-medium">{user.name}</div>
              <div className="text-xs text-muted">Freelancer</div>
            </div>
            {user.demo && <Badge tone="info">Demo</Badge>}
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                {user.demo ? "End demo" : "Sign out"}
              </Button>
            </form>
          </div>
        ) : (
          <form action={startDemo}>
            <Button size="sm" type="submit">
              Try the demo
            </Button>
          </form>
        )}
      </Container>
    </header>
  );
}
