# Vouch

Pay-on-proof for freelance work. The client's payment is held by PayPal (authorized, not captured). An AI referee checks each delivery against an agreed brief, a deterministic policy decides how much to release, and a human can always override.

**The AI proposes, the policy decides, a human can override.**

> Built for the PayPal AI Hackathon 2026. Runs on the PayPal sandbox; no real money moves.

## Status

Day 1. Done so far:

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
npm test                     # policy and schema tests
npm run smoke                # PayPal sandbox smoke test (opens an approval link)
npm run smoke -- --payee     # same, paying a second sandbox account as the freelancer
npm run dev
```

## PayPal APIs used

Orders v2 (create with intent AUTHORIZE, authorize) and Payments v2 (capture with `final_capture=false`, reauthorize, void, refund), all with `PayPal-Request-Id` idempotency keys, through `@paypal/paypal-server-sdk`.

## AI

Google Gemini (`gemini-3.8-flash`, free tier) through `@google/genai` drafts briefs and judges subjective criteria. It never moves money: `src/lib/policy` decides every release.

## Built with APIMatic

The PayPal integration is written with APIMatic's PayPal Server SDK skills and the ContextMatic plugin.

## License

MIT
