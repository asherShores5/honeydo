// M6 Polish browser checks. Run: npx tsx m6.ts  (after npm run build:web at the repo root)
import type { Page } from "playwright";
import { launch } from "./app";
import { calls, db, seed, setPasskeys } from "./backend";

const results: [string, boolean, string?][] = [];
async function check(name: string, fn: () => Promise<string | void>) {
  await closeSheets(failPage).catch(() => {});
  try { results.push([name, true, (await fn()) ?? ""]); } catch (e) {
    results.push([name, false, (e as Error).message.split("\n")[0]]);
    await shot(failPage, `FAIL-${results.length}`).catch(() => {});
  }
}
let failPage: Page;
const shot = (p: Page, n: string) => p.screenshot({ path: `/tmp/e2e/m6-${n}.png` });
const item = (id: string) => db.dump?.().find?.((r: any) => r.id === id);
const lastCall = (field: string) => [...calls].reverse().find((c) => c.field === field);
const row = (p: Page, title: string) => p.locator("li.item", { hasText: title }).first();
/** Home lists one tab at a time: pick the tab that holds `title`. */
async function reveal(p: Page, title: string) {
  for (const tab of [/^On track/, /^Overdue/]) {
    if (await row(p, title).isVisible()) return;
    await p.getByRole("button", { name: tab }).first().click();
    await p.waitForTimeout(200);
  }
}
async function swipe(p: Page, title: string, dx: number) {
  await reveal(p, title);
  await row(p, title).scrollIntoViewIfNeeded();
  const box = (await row(p, title).boundingBox())!;
  const y = box.y + box.height / 2, x = box.x + box.width / 2;
  await p.mouse.move(x, y); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(x + (dx * i) / 10, y + 1);
  await p.mouse.up();
}

/** datetime-local value for `ms`, in the page's zone (Pacific), not this machine's. */
function localInput(ms: number) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const v = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}
/** Close whatever sheet a failed check left open. */
async function closeSheets(p: Page) {
  for (let i = 0; i < 3 && (await p.getByRole("dialog").count()); i++) {
    const c = p.getByRole("dialog").last().getByRole("button", { name: "Cancel" });
    if (await c.count()) await c.first().click(); else await p.keyboard.press("Escape");
    await p.waitForTimeout(150);
  }
}
const now = Date.now();
await seed(now);
const nowSec = Math.floor(now / 1000);
setPasskeys("asher", [
  { CredentialId: "pk1", FriendlyCredentialName: "iPhone", RelyingPartyId: "honeydo.test", CreatedAt: nowSec - 86400 * 30 },
  { CredentialId: "pk2", FriendlyCredentialName: "Old phone", RelyingPartyId: "aubi.ashershores.com", CreatedAt: nowSec - 86400 * 90 },
]);
const app = await launch();
const asher = await app.open("asher");
const aubyn = await app.open("aubyn");
failPage = asher;
asher.on("dialog", (d) => d.accept());
await asher.getByPlaceholder(/Quick add/).waitFor();
await aubyn.getByPlaceholder(/Quick add/).waitFor();
await asher.waitForTimeout(500);

await check("quick-add: 'Mop floor every 3d #kitchen @aubyn' creates a Chore", async () => {
  const qa = asher.getByPlaceholder(/Quick add/);
  await qa.fill("Mop floor every 3d #kitchen @aubyn");
  await shot(asher, "quickadd-typed");
  await qa.press("Enter");
  await row(asher, "Mop floor").waitFor({ timeout: 4000 });
  const c = lastCall("putItem")!.args as any;
  const r = typeof c.input.recurrence === "string" ? JSON.parse(c.input.recurrence) : c.input.recurrence;
  if (c.input.title !== "Mop floor") throw new Error(`title=${c.input.title}`);
  if (c.input.kind !== "chore" || r?.every !== 3 || r?.unit !== "days") throw new Error(`kind=${c.input.kind} rec=${JSON.stringify(r)}`);
  if (!c.input.tags.includes("loc-kitchen")) throw new Error(`tags=${c.input.tags}`);
  if (c.input.assigneeId !== "sub-aubyn") throw new Error(`assignee=${c.input.assigneeId}`);
  return `kind=chore every 3 days, tags=${c.input.tags}, assignee=aubyn`;
});
await check("live: aubyn's phone shows Mop floor without reload", async () => {
  await row(aubyn, "Mop floor").waitFor({ timeout: 4000 });
});
await check("quick-add: 'Weekly report' stays a plain title", async () => {
  const qa = asher.getByPlaceholder(/Quick add/);
  await qa.fill("Weekly report"); await qa.press("Enter");
  await row(asher, "Weekly report").waitFor({ timeout: 4000 });
  const c = lastCall("putItem")!.args as any;
  if (c.input.title !== "Weekly report") throw new Error(`title=${c.input.title}`);
  return `kind=${c.input.kind}, recurrence=${c.input.recurrence ?? "none"}`;
});
await check("swipe right on Water plants marks it done", async () => {
  const before = calls.length;
  await swipe(asher, "Water plants", 160);
  await asher.waitForTimeout(800);
  await shot(asher, "swipe-right");
  const c = calls.slice(before).find((x) => x.field === "completeItem");
  if (!c) throw new Error(`no completeItem; calls: ${calls.slice(before).map((x) => x.field)}`);
  return `completeItem(${(c.args as any).itemId})`;
});
await check("swipe left on Take out trash opens the actions sheet", async () => {
  await swipe(asher, "Take out trash", -160);
  const sheet = asher.getByRole("dialog", { name: /Actions for Take out trash/ });
  await sheet.waitFor({ timeout: 3000 });
  await shot(asher, "swipe-left-sheet");
  const labels = await sheet.getByRole("button").allInnerTexts();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  return labels.join(" | ");
});
await check("a short sideways drag does nothing", async () => {
  const before = calls.length;
  await swipe(asher, "Take out trash", 40);
  await asher.waitForTimeout(500);
  if (await asher.getByRole("dialog").count()) throw new Error("a dialog opened");
  if (calls.length !== before) throw new Error(`calls: ${calls.slice(before).map((x) => x.field)}`);
});
await check("⋯ → Snooze 3 hours snoozes Buy groceries", async () => {
  await reveal(asher, "Buy groceries");
  await asher.getByRole("button", { name: "More for Buy groceries" }).click();
  const sheet = asher.getByRole("dialog", { name: /Actions for Buy groceries/ });
  await sheet.getByRole("button", { name: "3 hours" }).click();
  await asher.waitForTimeout(600);
  const c = lastCall("putItem")!.args as any;
  const h = (c.input.snoozedUntil - Date.now()) / 3600_000;
  if (c.input.id !== "groceries" || Math.abs(h - 3) > 0.1) throw new Error(`id=${c.input.id} snoozedUntil in ${h.toFixed(2)}h`);
  return `snoozedUntil ≈ now+${h.toFixed(2)}h`;
});
await check("⋯ → Done at… backdates Clean bathroom to 2h ago", async () => {
  await reveal(asher, "Clean bathroom");
  await asher.getByRole("button", { name: "More for Clean bathroom" }).click();
  const sheet = asher.getByRole("dialog", { name: /Actions for Clean bathroom/ });
  await sheet.getByRole("button", { name: "Done at…" }).click();
  const input = sheet.locator("input").first();
  await input.fill(localInput(Date.now() - 2 * 3600_000));
  await shot(asher, "done-at");
  await sheet.getByRole("button", { name: "Mark done" }).click();
  await asher.waitForTimeout(600);
  const c = lastCall("completeItem")!.args as any;
  const ago = (Date.now() - c.at) / 3600_000;
  if (c.itemId !== "bath" || ago < 1.9 || ago > 2.1) throw new Error(`itemId=${c.itemId} at ${ago.toFixed(2)}h ago`);
  return `completeItem(bath, at ≈ ${ago.toFixed(2)}h ago)`;
});
await check("Done at… rejects a future time", async () => {
  await reveal(asher, "Dishes");
  await asher.getByRole("button", { name: "More for Dishes" }).click();
  const sheet = asher.getByRole("dialog", { name: /Actions for Dishes/ });
  await sheet.getByRole("button", { name: "Done at…" }).click();
  await sheet.locator("input").first().fill(localInput(Date.now() + 3 * 3600_000));
  const disabled = await sheet.getByRole("button", { name: "Mark done" }).isDisabled();
  const text = await sheet.innerText();
  await shot(asher, "done-at-future");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  if (!disabled) throw new Error("Mark done enabled for a future time");
  return text.replace(/\s+/g, " ").slice(0, 120);
});
await check("Editor: Warn window 2 days on Clean bathroom saves", async () => {
  await reveal(asher, "Clean bathroom");
  await row(asher, "Clean bathroom").locator("button.body").click();
  await asher.waitForTimeout(400);
  await shot(asher, "opened");
  const edit = asher.getByRole("button", { name: /^Edit$/ });
  if (await edit.count()) await edit.first().click();
  const warn = asher.getByLabel("Warn window");
  await warn.waitFor({ timeout: 3000 });
  await warn.fill("2");
  await warn.locator("xpath=following-sibling::select").selectOption({ label: "days" }).catch(async () => {
    const sel = warn.locator("xpath=following-sibling::select");
    const opts = await sel.locator("option").allInnerTexts();
    await sel.selectOption({ label: opts.find((o) => /day/i.test(o))! });
  });
  await shot(asher, "editor-warn");
  await asher.getByRole("button", { name: /^Save$/ }).click();
  await asher.waitForTimeout(600);
  const c = lastCall("putItem")!.args as any;
  if (c.input.id !== "bath" || c.input.warnWindow !== 2 * 86_400_000) throw new Error(`id=${c.input.id} warnWindow=${c.input.warnWindow}`);
  return `putItem(bath, warnWindow=2d)`;
});
await check("Editor: Warn window 8 days on a 7-day Chore can't save", async () => {
  for (const sel of ["Close", "Done", "Back", "×"]) { const b = asher.getByRole("button", { name: sel, exact: true }); if (await b.count()) { await b.first().click(); break; } }
  await reveal(asher, "Clean bathroom");
  await row(asher, "Clean bathroom").locator("button.body").click();
  const edit = asher.getByRole("button", { name: /^Edit$/ });
  if (await edit.count()) await edit.first().click();
  const warn = asher.getByLabel("Warn window");
  await warn.fill("8");
  await asher.waitForTimeout(200);
  const save = asher.getByRole("button", { name: /^Save$/ });
  const disabled = await save.isDisabled();
  await shot(asher, "editor-warn-too-long");
  const msg = (await asher.locator(".sheet, [role=dialog]").last().innerText()).match(/[^\n]*(warn|interval|must)[^\n]*/i)?.[0];
  if (!disabled) throw new Error("Save enabled");
  return msg ?? "Save disabled";
});
await asher.reload(); await asher.getByPlaceholder(/Quick add/).waitFor();
await check("Settings: passkeys list shows both, remove the old one, last one can't be removed", async () => {
  await asher.getByRole("button", { name: "Settings" }).click();
  const list = asher.locator("ul.passkeys");
  await list.locator("li").first().waitFor({ timeout: 3000 });
  await shot(asher, "passkeys");
  const before = (await list.innerText()).replace(/\s+/g, " ");
  const remove = list.locator("li", { hasText: "Old phone" }).getByRole("button", { name: "Remove" });
  await remove.click();
  await asher.waitForTimeout(600);
  const after = (await list.innerText()).replace(/\s+/g, " ");
  await shot(asher, "passkeys-after");
  if (/Old phone/.test(after)) throw new Error(`still listed: ${after}`);
  if (!/Last one/.test(after) || (await list.getByRole("button", { name: "Remove" }).count())) throw new Error(`after: ${after}`);
  return `before: ${before} → after: ${after}`;
});

for (const [n, ok, d] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `\n      ${d}` : ""}`);
await app.close();
