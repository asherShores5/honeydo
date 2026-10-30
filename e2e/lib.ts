// Shared helpers for the check scripts.
import type { Page } from "playwright";
import { calls } from "./backend";

/** A checklist: run named checks, screenshot failures, print PASS/FAIL at the end. */
export function checklist(prefix: string) {
  const results: [string, boolean, string][] = [];
  let page: Page | undefined;
  return {
    /** The page to clean up and screenshot when a check fails. */
    watch: (p: Page) => void (page = p),
    async check(name: string, fn: () => Promise<string | void>) {
      for (const p of page ? [page] : []) await closeSheets(p).catch(() => {});
      try {
        results.push([name, true, (await fn()) ?? ""]);
      } catch (e) {
        results.push([name, false, (e as Error).message.split("\n")[0]]);
        if (page) await shot(page, `${prefix}-FAIL-${results.length}`).catch(() => {});
      }
    },
    report() {
      for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `\n      ${d}` : ""}`);
      const failed = results.filter((r) => !r[1]).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      return failed;
    },
  };
}

export const shot = (p: Page, n: string) => p.screenshot({ path: `/tmp/e2e/${n}.png` });
export const lastCall = (field: string) => [...calls].reverse().find((c) => c.field === field);
export const callsSince = (n: number) => calls.slice(n);
export const row = (p: Page, title: string) => p.locator("li.item", { hasText: title }).first();

/** Home lists one tab at a time: pick the tab that holds `title`. */
export async function reveal(p: Page, title: string) {
  for (const tab of [/^On track/, /^Overdue/]) {
    if (await row(p, title).isVisible()) return;
    await p.getByRole("button", { name: tab }).first().click();
    await p.waitForTimeout(200);
  }
}

export async function swipe(p: Page, title: string, dx: number) {
  await reveal(p, title);
  await row(p, title).scrollIntoViewIfNeeded();
  const box = (await row(p, title).boundingBox())!;
  const y = box.y + box.height / 2, x = box.x + box.width / 2;
  await p.mouse.move(x, y);
  await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(x + (dx * i) / 10, y + 1);
  await p.mouse.up();
}

/** datetime-local value for `ms`, in the page's zone (Pacific), not this machine's. */
export function localInput(ms: number) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const v = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}

/** Close whatever sheet a failed check left open. */
export async function closeSheets(p: Page) {
  for (let i = 0; i < 3 && (await p.getByRole("dialog").count()); i++) {
    const c = p.getByRole("dialog").last().getByRole("button", { name: "Cancel" });
    if (await c.count()) await c.first().click();
    else await p.keyboard.press("Escape");
    await p.waitForTimeout(150);
  }
}

/** Home's tab strip button (On track, Overdue, Finished, Activity, Fridge, Views). */
export async function tab(p: Page, name: string) {
  await p.locator("nav button", { hasText: new RegExp(`^${name}`) }).first().click();
  await p.waitForTimeout(250);
}
