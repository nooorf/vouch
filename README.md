# Vouch

Pay-on-proof for freelance work. The client's payment is held by PayPal (authorized, not captured). An AI referee checks each delivery against an agreed brief, a deterministic policy decides how much to release, and a human can always override.

**The AI proposes, the policy decides, a human can override.**

> Built for the PayPal AI Hackathon 2026. Runs on the PayPal sandbox; no real money moves.

## Status

Day 1. Done so far:

- App shell: landing page, "Try the demo" (a private demo workspace per visitor, signed session cookie) and the freelancer dashboard with the money bar.
- Job creation: describe the work, Gemini drafts a brief (structured JSON, repaired and validated in code), then a full editor with live lint warnings and the share of each payment backed by measured checks.
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
npm run e2e                  # browser walk-through of the demo against localhost:3000
npm run eval                 # AI evals: drafted briefs scored against fixed expectations (add --fresh to skip cache)
```

## Quality checks

- **Schemas at every boundary**: Zod validates AI output, form input, briefs and environment variables; Drizzle types the database.
- **Unit tests** (`npm test`) for the policy engine, money math, brief repair and lint, sessions, config and the AI layer (with a fake provider).
- **AI evals** (`npm run eval`) run the real model on fixed cases, including a prompt-injection attempt.
- **Browser walk-through** (`npm run e2e`) of the demo flow.
- **CI** on every push: typecheck, lint, unit tests, build.

## PayPal APIs used

Orders v2 (create with intent AUTHORIZE, authorize) and Payments v2 (capture with `final_capture=false`, reauthorize, void, refund), all with `PayPal-Request-Id` idempotency keys, through `@paypal/paypal-server-sdk`.

## AI

Google Gemini (`gemini-3.8-flash`, free tier) through `@google/genai` drafts briefs and judges subjective criteria. It never moves money: `src/lib/policy` decides every release.

## Built with APIMatic

The PayPal integration is written with APIMatic's PayPal Server SDK skills and the ContextMatic plugin.

## License

MIT
