/**
 * Browser walk-through of the demo, against a running app.
 *   npm run e2e                       # http://localhost:3000
 *   E2E_URL=https://vouch.example npm run e2e
 * Uses your installed Chrome (CHROME_PATH to override). Screenshots go to E2E_SHOTS if set.
 */
import { existsSync, mkdirSync } from "node:fs";
import { CheckoutPaymentIntent } from "@paypal/paypal-server-sdk";
import { eq } from "drizzle-orm";
import puppeteer, { type Page } from "puppeteer-core";
import { closeDb, db, schema } from "../src/db";
import { findJobByClientToken } from "../src/lib/jobs/agreement";
import { paypal, usd } from "../src/lib/paypal/client";
import { completeFunding } from "../src/lib/paypal/funding";

const BASE = (process.env.E2E_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.E2E_SHOTS;
/**
 * How the walk-through funds the job:
 * - "card" (default): a sandbox test card authorized server-side, then Vouch's real completeFunding().
 *   No buyer login, so repeated runs don't trip PayPal's bot protection.
 * - "popup": log in to PayPal's checkout popup as the demo buyer, like a person would.
 * - "auto": try the popup, fall back to the card if PayPal refuses the automated login.
 */
const PAYPAL_MODE = (process.env.E2E_PAYPAL ?? "card") as "card" | "popup" | "auto";

let failures = 0;
const STEP_LIMIT_MS = 5 * 60_000;

async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    // A hung step fails instead of hanging the whole run.
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Step took longer than ${STEP_LIMIT_MS / 60_000} minutes`)), STEP_LIMIT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    console.log(`  ✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failures++;
    console.log(`  ✘ ${name}\n    ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

async function clickByText(page: Page, selector: string, text: string) {
  const handle = await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.trim() === t && !el.closest("[hidden]")),
    { timeout: 15_000 },
    selector,
    text,
  );
  await (handle.asElement() as unknown as { click: () => Promise<void> }).click();
}

async function clickContaining(page: Page, selector: string, text: string) {
  const handle = await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => el.textContent?.includes(t) && !(el as HTMLButtonElement).disabled),
    { timeout: 30_000 },
    selector,
    text,
  );
  await (handle.asElement() as unknown as { click: () => Promise<void> }).click();
}

/**
 * Make the client's decision on a milestone. With one option it's a plain button; with several,
 * the client picks the option (a radio card) and then confirms. Matching ignores case.
 */
async function decide(page: Page, text: string) {
  const handle = await page.waitForFunction(
    (t) =>
      [...document.querySelectorAll<HTMLElement>("label")].find((el) => el.querySelector('input[type="radio"]') && el.textContent?.toLowerCase().includes(t)) ??
      [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.toLowerCase().includes(t) && !el.disabled),
    { timeout: 30_000 },
    text.toLowerCase(),
  );
  const isOption = await page.evaluate((el) => (el as unknown as HTMLElement).tagName === "LABEL", handle);
  await (handle.asElement() as unknown as { click: () => Promise<void> }).click();
  if (isOption) await clickContaining(page, "button", "Confirm decision");
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  // From the top, so the sticky header doesn't land mid-page in a full-page shot.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/**
 * Drive PayPal's sandbox checkout popup: email, password, then approve. PayPal navigates between
 * these screens on its own, so poll for whichever screen is showing instead of a fixed script.
 */
async function approveInPayPalPopup(popup: Page, email: string, password: string, budgetMs = 150_000) {
  // PayPal's pages can contain hidden duplicates of a field (e.g. two #email inputs), so always
  // act on the first *visible* match.
  const visibleOne = async (selectors: string) => {
    for (const el of await popup.$$(selectors)) if (await el.isVisible()) return el;
    return null;
  };
  const SUBMIT = '#payment-submit-btn, button[data-testid="submit-button-initial"], button[data-id="payment-submit-btn"]';
  const EMAIL = '#email, input[name="login_email"], input[type="email"]';
  const PASSWORD = '#password, input[name="login_password"], input[type="password"]';
  const NEXT = "#btnNext";
  const LOGIN = "#btnLogin";

  // Each step may need more than one try: PayPal re-renders its forms while scripts load.
  const tries = { email: 0, password: 0 };
  let lastAction = 0;
  const settle = () => Date.now() - lastAction > 6000;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (popup.isClosed()) return; // PayPal closes the popup after approval
    try {
      const submit = await visibleOne(SUBMIT);
      const pw = await visibleOne(PASSWORD);
      const em = pw ? null : await visibleOne(EMAIL);
      if (submit) {
        await submit.click();
        lastAction = Date.now();
      } else if (pw && tries.password < 4 && (tries.password === 0 || settle())) {
        const value = await pw.evaluate((el) => (el as HTMLInputElement).value);
        if (!value) await pw.type(password);
        const login = await visibleOne(LOGIN);
        if (login && tries.password % 2 === 0) await login.click();
        else await pw.press("Enter");
        tries.password++;
        lastAction = Date.now();
      } else if (em && tries.email < 4 && (tries.email === 0 || settle())) {
        await em.click({ count: 3 });
        await em.type(email);
        const next = await visibleOne(NEXT);
        if (next) await next.click();
        else await em.press("Enter");
        tries.email++;
        lastAction = Date.now();
      }
    } catch (err) {
      // "Execution context was destroyed" etc.: PayPal navigated mid-action. Look again.
      if (popup.isClosed()) return;
      if (!/context|detached|navigat|Target closed|not clickable|Node is/i.test(String(err))) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (SHOTS && !popup.isClosed()) {
    if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
    await popup.screenshot({ path: `${SHOTS}/paypal-popup-stuck.png`, fullPage: true }).catch(() => undefined);
    console.log(`    popup URL: ${popup.url()}`);
  }
  throw new Error(`PayPal popup did not finish within ${budgetMs / 1000} s`);
}

/** Fund the job behind a client link with a sandbox test card, through Vouch's real funding code. */
async function fundWithTestCard(clientUrl: string) {
  const token = new URL(clientUrl).pathname.split("/").pop()!;
  const job = await findJobByClientToken(token);
  if (!job) throw new Error("Job not found for client link");
  const { result: order } = await paypal().orders.createOrder({
    paypalRequestId: `e2e-card-${job.id}`,
    body: {
      intent: CheckoutPaymentIntent.Authorize,
      purchaseUnits: [{ referenceId: job.id, customId: job.id, amount: usd(job.totalCents) }],
      paymentSource: { card: { number: "4032039317984658", expiry: "2030-12", securityCode: "123", name: "Vouch E2E" } },
    },
  });
  await db.update(schema.jobs).set({ paypalOrderId: order.id! }).where(eq(schema.jobs.id, job.id));
  const result = await completeFunding(job.id, order.id!, "client");
  if (result !== "funded") throw new Error(`completeFunding returned ${result}`);
}

async function main() {
  console.log(`E2E against ${BASE}\n`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
  const page = await browser.newPage();
  // Screenshots at retina scale, sharp enough for the README.
  await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: SHOTS ? 2 : 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // "Leave with unsaved changes?" prompts: the test leaves on purpose.
  page.on("dialog", (d) => void d.accept());

  try {
    await step("Landing page loads", async () => {
      await page.goto(BASE, { waitUntil: "networkidle0" });
      await page.waitForSelector("h1");
    });

    await step("Try the demo opens a private workspace", async () => {
      await Promise.all([page.waitForNavigation(), clickByText(page, "main button", "Try the demo")]);
      if (!page.url().endsWith("/dashboard")) throw new Error(`Landed on ${page.url()}`);
      await page.waitForFunction(() => document.body.innerText.includes("private demo workspace"));
    });

    await step("Create a job from the example (AI draft)", async () => {
      await Promise.all([page.waitForNavigation(), clickByText(page, "a", "Create your first job")]);
      await clickByText(page, "button", "Use the coffee roastery example");
      await Promise.all([
        page.waitForNavigation({ timeout: 150_000 }),
        clickByText(page, "button", "Draft the brief with AI"),
      ]);
      if (!/\/jobs\/[0-9a-f-]+\/brief$/.test(page.url())) throw new Error(`Landed on ${page.url()}`);
      await page.waitForFunction(() => document.body.innerText.includes("Total held from the client"));
      const total = await page.$eval("aside", (el) => el.textContent ?? "");
      if (!total.includes("$400")) throw new Error("Sidebar total is not $400");
    });
    await shot(page, "brief-editor");

    await step("Edit a milestone title and save", async () => {
      const titleInput = await page.waitForSelector('input[aria-label="Milestone title"]');
      await titleInput!.click({ count: 3 });
      await titleInput!.type("Structure, story and copy");
      await clickByText(page, "button", "Save changes");
      await page.waitForFunction(() => document.body.innerText.includes("Saved at"), { timeout: 15_000 });
    });

    await step("Edit survives a reload", async () => {
      await page.reload({ waitUntil: "networkidle0" });
      const value = await page.$eval('input[aria-label="Milestone title"]', (el) => (el as HTMLInputElement).value);
      if (value !== "Structure, story and copy") throw new Error(`Title after reload: ${value}`);
    });

    await step("Invalid edit is rejected with a message", async () => {
      const titleInput = await page.waitForSelector('input[aria-label="Milestone title"]');
      await titleInput!.click({ count: 3 });
      await page.keyboard.press("Backspace");
      await clickByText(page, "button", "Save changes");
      await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("title"), { timeout: 15_000 });
    });

    // Pages refresh themselves as windows close; a refresh mid-wait just means "look again".
    const text = async (t: string, timeout = 15_000) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        try {
          return await page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: Math.max(1000, deadline - Date.now()) }, t);
        } catch (err) {
          if (Date.now() >= deadline || /ms exceeded/.test(String(err))) throw err;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    const nav = (fn: () => Promise<void>) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), fn()]);

    await step("Send v1 to the client", async () => {
      await page.reload({ waitUntil: "networkidle0" }); // drop the invalid edit
      await clickByText(page, "button", "Send v1 to the client");
      await nav(() => clickByText(page, "button", "Send now"));
      if (!/\/jobs\/[0-9a-f-]+\?sent=1$/.test(page.url())) throw new Error(`Landed on ${page.url()}`);
      await text("Sent v1 to the client");
      const link = await page.$eval('input[aria-label="Client link"]', (el) => (el as HTMLInputElement).value);
      if (!/\/c\/[A-Za-z0-9_-]{43}$/.test(link)) throw new Error(`Bad client link ${link}`);
    });
    await shot(page, "job-sent");

    await step("Client view via the demo switcher", async () => {
      await nav(() => clickByText(page, "a", "Client"));
      if (!/\/c\/[A-Za-z0-9_-]{43}$/.test(page.url())) throw new Error(`Landed on ${page.url()}`);
      await text("Accept this brief");
    });
    await shot(page, "client-review");

    await step("Client requests changes", async () => {
      await clickByText(page, "button", "Request changes");
      await page.type("#note", "Please make the first milestone $210 and keep the total fair.");
      await clickByText(page, "button", "Send as a note instead");
      await text("Being revised");
    });

    await step("Freelancer sees the request and revises the amount", async () => {
      await nav(() => clickByText(page, "a", "Freelancer"));
      await text("Client asked for changes to v1");
      await nav(() => clickByText(page, "a", "Revise the brief"));
      await text("The client asked for changes to v1");
      const amount = await page.waitForSelector('input[aria-label="Milestone amount"]');
      await amount!.click({ count: 3 });
      await amount!.type("210");
      await clickByText(page, "button", "Save changes");
      await text("Saved at");
      await clickByText(page, "button", "Send v2 to the client");
      await nav(() => clickByText(page, "button", "Send now"));
      await text("Sent v2 to the client");
    });

    await step("Client sees what changed in v2", async () => {
      await nav(() => clickByText(page, "a", "Client"));
      await text("What changed since v1");
      await text("Amount:");
      await shot(page, "client-changes");
    });

    await step("Client asks AI to draft a change and proposes v3", async () => {
      await clickByText(page, "button", "Request changes");
      await page.type("#note", "Please also make sure the page mentions our café locations: Shoreditch and Hackney.");
      await clickByText(page, "button", "Draft the changes with AI");
      await text("Shoreditch", 150_000);
      await clickByText(page, "button", "Propose v3 to Sam Rivera");
      await text("Your proposal");
    });
    await shot(page, "client-proposed");

    await step("Freelancer accepts the client's v3 in one click", async () => {
      await nav(() => clickByText(page, "a", "Freelancer"));
      await text("The client proposed v3");
      await clickByText(page, "button", "Accept v3");
      await text("Agreed on v3");
      await text("Both sides agreed on the same version");
    });

    await step("Client sees the agreed brief", async () => {
      await nav(() => clickByText(page, "a", "Client"));
      await text("You and Sam Rivera agreed on v3");
    });
    await shot(page, "client-agreed");

    const buyerEmail = process.env.DEMO_BUYER_EMAIL;
    const buyerPassword = process.env.DEMO_BUYER_PASSWORD;
    await step("PayPal button renders on the agreed brief", async () => {
      const iframe = await page.waitForSelector('iframe[title*="PayPal"]', { timeout: 45_000 });
      const frame = await iframe!.contentFrame();
      await frame.waitForSelector('[data-funding-source="paypal"]', { visible: true, timeout: 45_000 });
    });
    await shot(page, "client-fund");

    if (!buyerEmail || !buyerPassword) {
      console.log("  - Skipping PayPal funding: set DEMO_BUYER_EMAIL and DEMO_BUYER_PASSWORD in .env.local");
    } else {
      await step(`Client funds the job (${PAYPAL_MODE === "card" ? "sandbox test card" : "PayPal sandbox popup"})`, async () => {
        await text("Fund the job to start the work");
        let funded = false;
        if (PAYPAL_MODE !== "card") {
          try {
            const iframe = await page.waitForSelector('iframe[title*="PayPal"]', { timeout: 30_000 });
            const frame = await iframe!.contentFrame();
            const popupPromise = new Promise<Page>((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("PayPal's popup didn't open within 30 s")), 30_000);
              browser.once("targetcreated", async (t) => {
                const p = await t.page();
                clearTimeout(timer);
                if (p) resolve(p);
                else reject(new Error("PayPal's popup opened without a page"));
              });
            });
            await frame.waitForSelector('[data-funding-source="paypal"]', { visible: true, timeout: 30_000 });
            await frame.click('[data-funding-source="paypal"]');
            const popup = await popupPromise;
            await approveInPayPalPopup(popup, buyerEmail, buyerPassword, PAYPAL_MODE === "auto" ? 60_000 : 150_000);
            await text("is held by PayPal", 120_000);
            funded = true;
          } catch (err) {
            if (PAYPAL_MODE === "popup") throw err;
            console.log(`    PayPal refused the automated login (${err instanceof Error ? err.message : err}); using a sandbox test card instead`);
            for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => undefined);
          }
        }
        if (!funded) {
          await fundWithTestCard(page.url());
          await page.reload({ waitUntil: "networkidle0" });
          await text("is held by PayPal", 30_000);
        }
      });
      await shot(page, "client-funded");

      await step("Freelancer sees the job funded with milestones", async () => {
        await nav(() => clickByText(page, "a", "Freelancer"));
        await text("Funded");
        await text("Waiting for delivery");
        await text("authorized");
      });

      await step("Freelancer submits the good demo site for M1", async () => {
        await clickByText(page, "button", "Good site");
        await clickByText(page, "button", "Submit for checking");
        // A fast check can finish before the page refreshes, so either state counts.
        await page.waitForFunction(() => /Checking the delivery|M1 delivery/.test(document.body.innerText), { timeout: 30_000 });
      });

      await step("The referee checks it and shows a verdict with evidence", async () => {
        await page.waitForFunction(() => /Passed|Partly met|Not met|Needs a person/.test(document.body.innerText) && !document.body.innerText.includes("Checking the delivery"), { timeout: 180_000 });
        await text("Main heading");
        await text("AI ·");
      });
      await shot(page, "evaluation-freelancer");

      await step("The client sees the same evaluation", async () => {
        await nav(() => clickByText(page, "a", "Client"));
        await page.waitForFunction(() => /Passed|Partly met|Not met|Needs a person/.test(document.body.innerText), { timeout: 30_000 });
        await text("M1 delivery");
      });

      const bodyHas = (t: string) => page.evaluate((x) => document.body.innerText.includes(x), t);
      let m1Partial = false;
      await step("Silence rule: the review window closes and the verdict executes", async () => {
        // Demo review windows are short; with no client action, the verdict executes through PayPal.
        // The window itself is 2 minutes; allow for the PayPal capture after it closes.
        await page.waitForFunction(() => /Released in full|stays held until a fix is accepted|Nothing released yet/.test(document.body.innerText), { timeout: 180_000 });
        m1Partial = !(await bodyHas("Released in full"));
      });
      await shot(page, "silence-release");

      if (m1Partial) {
        await step("Freelancer resubmits M1 and the client approves the rest", async () => {
          await nav(() => clickByText(page, "a", "Freelancer"));
          await clickByText(page, "button", "Good site");
          if (await page.$("#delivery-repo")) await page.type("#delivery-repo", "https://github.com/sindresorhus/is");
          await clickByText(page, "button", "Resubmit for checking");
          await page.waitForFunction(() => /try 2 of/.test(document.body.innerText) && !document.body.innerText.includes("Checking the delivery"), { timeout: 180_000 });
          await nav(() => clickByText(page, "a", "Client"));
          await decide(page, "release");
          await text("Released in full", 60_000);
        });
      }

      // Submit M2's flawed site as try `n` of `of`, and wait for that delivery's own verdict (a
      // withdrawn earlier delivery is on the page too, so "M2 delivery" alone proves nothing).
      const submitFlawed = async (label: string, n: number, of: number) => {
        await nav(() => clickByText(page, "a", "Freelancer"));
        await clickByText(page, "button", "Flawed site");
        await clickByText(page, "button", label);
        await page.waitForFunction(
          (header) => document.body.innerText.includes(header) && !document.body.innerText.includes("Checking the delivery"),
          { timeout: 180_000 },
          `M2 delivery · try ${n} of ${of}`,
        );
      };

      await step("M2: freelancer submits the flawed site and the referee finds its problems", async () => {
        await submitFlawed("Submit for checking", 1, 2);
        await text("viewport");
      });

      await step("Freelancer withdraws it and the client sees it was withdrawn", async () => {
        await clickByText(page, "button", "Withdraw delivery");
        await clickByText(page, "button", "Yes, withdraw it");
        await text("You withdrew this delivery", 30_000);
        await text("Try 2 of 2: your last one");
        await nav(() => clickByText(page, "a", "Client"));
        await text("withdrew this delivery");
      });

      await step("Last try: the client disputes, the AI re-checks, and the client holds it", async () => {
        await submitFlawed("Resubmit for checking", 2, 2);
        await nav(() => clickByText(page, "a", "Client"));
        // A "needs a person" verdict has no dispute: the client decides straight away.
        if (await bodyHas("Dispute this result")) {
          await clickByText(page, "button", "Dispute this result");
          await page.click('form input[type="checkbox"]');
          await page.type("textarea[id^='note-']", "The site looks fine on my phone; please check the mobile layout again.");
          await clickByText(page, "button", "Dispute and re-check");
          await text("The client disputed the result and the AI checked again", 180_000);
        }
        // If the window already closed, silence has held it for us.
        if (await bodyHas("Hold for a fix")) await decide(page, "Hold for a fix");
        await page.waitForFunction(() => /Nothing released yet|stays held until a fix is accepted/.test(document.body.innerText), { timeout: 60_000 });
      });
      await shot(page, "dispute-held");

      await step("Out of tries: only the client moves things on, and the next milestone stays closed", async () => {
        await text("has used every try for M2", 30_000);
        await text("End the project");
        await text("Skip this milestone");
        await nav(() => clickByText(page, "a", "Freelancer"));
        await text("You've used every try for M2");
        if (await bodyHas("Submit M3")) throw new Error("M3 opened while M2 was still undecided");
        if (await bodyHas("Resubmit M2")) throw new Error("The freelancer can resubmit with no tries left");
      });

      await step("Client gives another try, and the freelancer uses it", async () => {
        await nav(() => clickByText(page, "a", "Client"));
        await decide(page, "another try");
        await nav(() => clickByText(page, "a", "Freelancer"));
        await text("Try 3 of 3", 30_000);
        await submitFlawed("Resubmit for checking", 3, 3);
      });

      await step("Client stays silent: the review window closes and the client must decide", async () => {
        // Two demo minutes, plus one extension when a person has to decide.
        await nav(() => clickByText(page, "a", "Client"));
        await text("has used every try for M2", 290_000);
      });

      await step("The decision time runs out: the project ends and the unpaid money goes back", async () => {
        await text("Cancelled", 240_000);
        await text("released back to you", 60_000);
      });
      await shot(page, "receipt");
      await nav(() => clickByText(page, "a", "Freelancer"));
    }

    await step("The agreed brief is locked", async () => {
      await nav(() => clickByText(page, "a", "Freelancer"));
      const res = await page.goto(page.url().replace(/\?.*$/, "") + "/brief", { waitUntil: "networkidle0" });
      if (!res || !/\/jobs\/[0-9a-f-]+$/.test(page.url())) throw new Error(`Editor still reachable: ${page.url()}`);
    });

    await step("Dashboard lists the job", async () => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
      await text(buyerEmail && buyerPassword ? "Cancelled" : "Agreed");
    });

    if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => console.log(failures ? `\n${failures} step(s) failed` : "\nAll steps passed"))
  .catch((err) => {
    console.log(`\nE2E failed: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
