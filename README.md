# Vouch

Pay-on-proof for freelance work. The client's payment is held by PayPal (authorized, not captured). An AI referee checks each delivery against an agreed brief, a deterministic policy decides how much to release, and a human can always override.

**The AI proposes, the policy decides, a human can override.**

> Built for the PayPal AI Hackathon 2026. Runs on the PayPal sandbox; no real money moves.

## Status

Day 1. Done so far:

- App shell: landing page, "Try the demo" (a private demo workspace per visitor, signed session cookie) and the freelancer dashboard with the money bar.
- Job creation: describe the work, Gemini drafts a brief (structured JSON, repaired and validated in code), then a full editor with live lint warnings and the share of each payment backed by measured checks.
- Negotiation: the brief goes to the client at a private link; the client accepts, sends a note, or has AI turn their request into concrete edits (applied and diffed in code); both sides must accept the same version before funding.
- Funding: the client pays with PayPal on the agreed brief; the agreed total is authorized (held, not captured), checked against the database, and milestones get due dates. Interrupted checkouts are recovered on the next page load; unfunded agreements expire after 72 hours.
- Referee (measured part): an SSRF-safe fetcher, the check library (page structure, phone readiness, alt text, forms, phrases, links, size), Google Lighthouse via PageSpeed, GitHub repo checks, and a detector for content aimed at AI graders. Four demo delivery sites (good, flawed, fixed, hostile) are served at `/demo-sites/*`.
- Referee (deciding part): deliveries are checked in a background task queue; the AI judge answers the subjective criteria from visible page text and a screenshot, and every quote it gives is verified against the page; the policy engine gives PASS / PARTIAL / FAIL / NEEDS_HUMAN with exact amounts, shown on an evaluation card to both sides.
- Money release: when a review window closes the verdict executes through PayPal captures (the silence rule); the client can approve, dispute (one AI re-check with their objection, then they decide), release the measured share, hold for a fix or close a milestone. Every capture is reserved before PayPal is called, with a deterministic request id, so retries and simultaneous clicks never pay twice. When every milestone is settled the unused hold is voided and both sides get a receipt with PayPal's transaction ids.
- Web apps are judged as a visitor sees them: every delivery is loaded in a real browser (Kernel cloud browsers when deployed, local Chrome in development) at phone and desktop sizes; checks for JavaScript errors, failed or unanswered API calls (a dead backend) and phone layout. A real-world benchmark (`npm run eval -- referee`: TodoMVC, RealWorld apps, an uncustomized template, the W3C before/after sites…) scores the referee. These 12 sites are our development set (we fixed what they revealed), so their score (12/12 verdicts, 59/59 criteria) shows the approach works, not how it does on sites it hasn't seen.
- `src/lib/policy/`: the policy engine (verdicts, partial releases, review window, capture guards), with tests.
- `src/lib/brief/`: the brief schema, check library, agreement hash and demo brief, with tests.
- `src/db/`: Postgres schema (Drizzle) for jobs, brief versions, milestones, evaluations, payments, the event ledger and a task queue; migrations in `drizzle/`.
- `scripts/smoke.ts`: PayPal sandbox smoke test (authorize, two partial captures, idempotent retry, void, refund).

## Run it

```bash
npm install
cp .env.example .env.local   # fill in the PayPal sandbox values
npm run db:migrate           # create the tables on your Neon database
npm run db:check             # verify the connection and constraints (rolls back)
npm run demo:warm            # pre-compute the AI draft for the demo example (instant demo)
npm test                     # unit tests (policy, brief, money, session)
npm run smoke                # PayPal sandbox smoke test (opens an approval link)
npm run smoke -- --payee     # same, paying a second sandbox account as the freelancer
npm run env:check            # validate config and list which features are on
npm run dev
npm run e2e                  # browser walk-through of the demo against localhost:3000 (funds with a sandbox test card; E2E_PAYPAL=popup to log in to PayPal's checkout instead)
npm run referee -- <url>     # run the measured checks on any URL (REFEREE_ALLOW_LOCALHOST=true for local demo sites)
npm run demo:cleanup         # remove demo workspaces and void their PayPal holds
npm run eval                 # AI evals: brief drafting, change proposals and the judge (add --fresh to skip cache)
```

## Quality checks

- **Schemas at every boundary**: Zod validates AI output, form input, briefs and environment variables; Drizzle types the database.
- **Unit tests** (`npm test`) for the policy engine, money math, brief repair and lint, sessions, config and the AI layer (with a fake provider).
- **AI evals** (`npm run eval`) run the real model on fixed cases, including a prompt-injection attempt.
- **Browser walk-through** (`npm run e2e`) of the demo flow.
- **CI** on every push: typecheck, lint, unit tests, build.

## PayPal APIs used

Orders v2 (create with intent AUTHORIZE, authorize, get) and Payments v2 (partial captures with `final_capture=false`, reauthorize after the honor period, void of the unused hold), all with `PayPal-Request-Id` idempotency keys, through `@paypal/paypal-server-sdk`; the PayPal JavaScript SDK buttons (`@paypal/react-paypal-js`) for checkout.

## AI

Google Gemini (`gemini-3.8-flash`, free tier) through `@google/genai` drafts briefs and judges subjective criteria. It never moves money: `src/lib/policy` decides every release.

## Built with APIMatic

The PayPal integration is written with APIMatic's PayPal Server SDK skills and the ContextMatic plugin.

## License

MIT
