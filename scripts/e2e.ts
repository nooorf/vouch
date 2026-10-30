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

    await step("Dashboard lists the job", async () => {
      await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => document.body.innerText.includes("$400"));
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
