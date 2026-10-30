// Home quick sort (Due date / Priority / A–Z), plus the Tag board, Warn window hint and desktop
// sheet header fixes. Run: npx tsx sort.ts
import { launch } from "./app";
import { graphql, seed } from "./backend";
import { checklist, lastCall, row, shot, tab } from "./lib";

const { check, watch, report } = checklist("sort");
await seed();
const app = await launch();
const p = await app.open("asher");
watch(p);
p.on("dialog", (d) => (d.type() === "prompt" ? d.accept("By priority") : d.accept()));
await p.getByPlaceholder(/Quick add/).waitFor();
await p.waitForTimeout(400);
const titles = () => p.locator("li.item .title").allInnerTexts().then((t) => t.map((x) => x.replace(/\s*(low|medium|high)\s*$/i, "").replace(/\s*🔒\s*$/, "").trim()));
const sortBtn = (name: string) => p.getByRole("group", { name: "Sort" }).getByRole("button", { name, exact: true });

await check("default is Due date: soonest first, undated last", async () => {
  if ((await sortBtn("Due date").getAttribute("aria-pressed")) !== "true") throw new Error("Due date not pressed");
  const t = await titles();
  if (t.join("|") !== "Buy groceries|Water plants|Take out trash|Birthday gift") throw new Error(t.join(", "));
  await shot(p, "sort-due");
  return t.join(", ");
});
await check("Priority: high (trash), medium (groceries), then the rest by due", async () => {
  await sortBtn("Priority").click();
  const t = await titles();
  if (t.join("|") !== "Take out trash|Buy groceries|Water plants|Birthday gift") throw new Error(t.join(", "));
  await shot(p, "sort-priority");
  return t.join(", ");
});
await check("A–Z: by title, case-insensitive", async () => {
  await sortBtn("A–Z").click();
  const t = await titles();
  const sorted = [...t].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (t.join("|") !== sorted.join("|")) throw new Error(t.join(", "));
  return t.join(", ");
});
await check("Overdue tab uses the same sort", async () => {
  await tab(p, "Overdue");
  const t = await titles();
  await tab(p, "On track");
  if (t.join("|") !== "Clean bathroom|Dishes") throw new Error(t.join(", "));
  return t.join(", ");
});
await check("the choice is remembered (saved on the default view, survives reload)", async () => {
  await sortBtn("Priority").click();
  await p.waitForTimeout(1600); // default view saves after 1.2s
  const saved = (lastCall("saveViews")?.args as any)?.defaultView;
  const dv = typeof saved === "string" ? JSON.parse(saved) : saved;
  await p.reload();
  await p.getByPlaceholder(/Quick add/).waitFor();
  const pressed = await sortBtn("Priority").getAttribute("aria-pressed");
  if (dv?.sort !== "priority" || pressed !== "true") throw new Error(`saved=${JSON.stringify(dv)} pressed=${pressed}`);
  return "defaultView.sort=priority, still Priority after reload";
});
await check("Save view keeps the current sort", async () => {
  await p.getByRole("button", { name: /^Filter/ }).click();
  await p.getByRole("button", { name: "Save view" }).click();
  await p.waitForTimeout(500);
  const v = (lastCall("saveViews")?.args as any)?.savedViews;
  const views = typeof v === "string" ? JSON.parse(v) : v;
  const mine = views?.find((x: any) => x.name === "By priority");
  if (mine?.sort !== "priority") throw new Error(JSON.stringify(mine));
  return `Saved view sort=${mine.sort}`;
});
await check("Tag board cards have no 💤 button (⋯ still offers Snooze)", async () => {
  await tab(p, "Views");
  await p.getByRole("button", { name: "Tag board", exact: true }).click();
  await p.waitForTimeout(300);
  await shot(p, "sort-board");
  const snoozeBtns = await p.locator(".board button.snooze").count();
  const more = await p.locator(".board button.more").count();
  if (snoozeBtns) throw new Error(`${snoozeBtns} 💤 buttons`);
  if (!more) throw new Error("no ⋯ buttons");
  return `${more} cards with ⋯ and ✓ only`;
});
await check("Editor: Turn yellow hint is a number in the chosen unit", async () => {
  await tab(p, "On track");
  await row(p, "Water plants").locator("button.body").click();
  const warn = p.getByLabel("Warn window");
  const days = await warn.getAttribute("placeholder");
  await warn.locator("xpath=following-sibling::select").selectOption("hours");
  const hours = await warn.getAttribute("placeholder");
  await shot(p, "sort-warn-hint");
  await p.getByRole("button", { name: "Cancel" }).first().click();
  if (days !== "1" || hours !== "24") throw new Error(`days=${days} hours=${hours}`);
  return `days: "${days}", hours: "${hours}"`;
});

const d = await app.open("asher", { device: "desktop" });
watch(d);
await d.getByPlaceholder(/Quick add/).waitFor();
await check("desktop: sheet header buttons line up with the 640px body", async () => {
  await row(d, "Water plants").locator("button.body").click();
  await d.waitForTimeout(300);
  const r = await d.getByRole("dialog").last().evaluate((el) => {
    const body = el.querySelector(".sheet-body")!.getBoundingClientRect();
    const btns = [...el.querySelectorAll(".sheet-head button")].map((b) => b.getBoundingClientRect());
    return { bodyLeft: body.left, bodyRight: body.right, first: btns[0].left, last: btns.at(-1)!.right };
  });
  await shot(d, "sort-desktop-sheet");
  if (Math.abs(r.first - r.bodyLeft) > 24 || Math.abs(r.last - r.bodyRight) > 24) throw new Error(JSON.stringify(r));
  return `body ${Math.round(r.bodyLeft)}–${Math.round(r.bodyRight)}px, buttons ${Math.round(r.first)}–${Math.round(r.last)}px`;
});

const failed = report();
await app.close();
process.exit(failed ? 1 : 0);
