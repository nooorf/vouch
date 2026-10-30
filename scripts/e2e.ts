/**
 * Browser walk-through of the demo, against a running app.
 *   npm run e2e                       # http://localhost:3000
 *   E2E_URL=https://vouch.example npm run e2e
 * Uses your installed Chrome (CHROME_PATH to override). Screenshots go to E2E_SHOTS if set.
 */
import { existsSync, mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = (process.env.E2E_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHOTS = process.env.E2E_SHOTS;

let failures = 0;
async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
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

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/**
 * Drive PayPal's sandbox checkout popup: email, password, then approve. PayPal navigates between
 * these screens on its own, so poll for whichever screen is showing instead of a fixed script.
 */
async function approveInPayPalPopup(popup: Page, email: string, password: string) {
  const submit = '#payment-submit-btn, button[data-testid="submit-button-initial"], button[data-id="payment-submit-btn"]';
  const visible = async (sel: string) => {
    const el = await popup.$(sel);
    return el ? el.isVisible() : false;
  };
  const done = { email: false, password: false };
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    if (popup.isClosed()) return; // PayPal closes the popup after approval
    try {
      if (await visible(submit)) {
        await popup.click(submit);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!done.password && (await visible("#password"))) {
        await popup.click("#password", { count: 3 });
        await popup.type("#password", password);
        await popup.click("#btnLogin");
        done.password = true;
      } else if (!done.email && (await visible("#email"))) {
        await popup.click("#email", { count: 3 });
        await popup.type("#email", email);
        if (await visible("#btnNext")) await popup.click("#btnNext");
        done.email = true;
      }
    } catch (err) {
      // "Execution context was destroyed" etc.: PayPal navigated mid-action. Look again.
      if (popup.isClosed()) return;
      if (!/context|detached|navigat|Target closed/i.test(String(err))) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("PayPal popup did not finish within 150 s");
}

async function main() {
  console.log(`E2E against ${BASE}\n`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
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

    const text = (t: string, timeout = 15_000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
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
      await step("Client funds the job with the PayPal sandbox", async () => {
        await text("Fund the job to start the work.");
        const iframe = await page.waitForSelector('iframe[title*="PayPal"]', { timeout: 30_000 });
        const frame = await iframe!.contentFrame();
        const popupPromise = new Promise<Page>((resolve) =>
          browser.once("targetcreated", async (t) => {
            const p = await t.page();
            if (p) resolve(p);
          }),
        );
        await frame.waitForSelector('[data-funding-source="paypal"]', { visible: true, timeout: 30_000 });
        await frame.click('[data-funding-source="paypal"]');
        const popup = await popupPromise;
        await approveInPayPalPopup(popup, buyerEmail, buyerPassword);
        await text("is held by PayPal", 120_000);
      });
      await shot(page, "client-funded");

      await step("Freelancer sees the job funded with milestones", async () => {
        await nav(() => clickByText(page, "a", "Freelancer"));
        await text("Funded");
        await text("Waiting for delivery");
        await text("authorized");
      });
    }

    await step("The agreed brief is locked", async () => {
      await nav(() => clickByText(page, "a", "Freelancer"));
      const res = await page.goto(page.url().replace(/\?.*$/, "") + "/brief", { waitUntil: "networkidle0" });
      if (!res || !/\/jobs\/[0-9a-f-]+$/.test(page.url())) throw new Error(`Editor still reachable: ${page.url()}`);
    });

    await step("Dashboard lists the job", async () => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
      await text(buyerEmail && buyerPassword ? "funded" : "agreed");
    });

    if (errors.length) throw new Error(`Browser errors:\n${errors.join("\n")}`);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => console.log(failures ? `\n${failures} step(s) failed` : "\nAll steps passed"))
  .catch(() => {
    console.log("\nE2E failed");
    process.exitCode = 1;
  });
