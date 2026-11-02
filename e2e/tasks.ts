// Top-level Tasks tab: every open one-off Task (overdue too), same filter and sort, + starts a Task.
import { launch } from "./app";
import { graphql, seed } from "./backend";
import { checklist, lastCall, row, shot, tab } from "./lib";

const { check, watch, report } = checklist("tasks");
const now = Date.now();
await seed(now);
// An overdue Task, so the tab provably isn't just "On track minus Chores".
await graphql("fake-id.aubyn", `mutation($input: ItemInput!) { putItem(input: $input) { visibility } }`, {
  input: { id: "vet", kind: "task", title: "Call the vet", tags: [], visibility: "shared", archived: false, dueAt: now - 3 * 3600_000 },
});
const app = await launch();
const p = await app.open("asher");
watch(p);
await p.getByPlaceholder(/Quick add/).waitFor();
await p.waitForTimeout(400);
const titles = () => p.locator("li.item .title").allInnerTexts().then((t) => t.map((x) => x.replace(/\s*(low|medium|high)\s*$/i, "").replace(/\s*🔒\s*$/, "").trim()));

await check("Tasks tab lists only open Tasks, overdue included, with a count", async () => {
  const label = await p.locator("nav button", { hasText: /^Tasks/ }).innerText();
  await tab(p, "Tasks");
  await shot(p, "tasks-tab");
  const t = await titles();
  if (t.join("|") !== "Call the vet|Buy groceries|Birthday gift") throw new Error(t.join(", "));
  if (!/3/.test(label)) throw new Error(`tab label "${label}"`);
  return `${label.replace(/\s+/g, " ")}: ${t.join(", ")}`;
});
await check("Sort buttons work on Tasks (A–Z)", async () => {
  await p.getByRole("group", { name: "Sort" }).getByRole("button", { name: "A–Z", exact: true }).click();
  const t = await titles();
  await p.getByRole("group", { name: "Sort" }).getByRole("button", { name: "Due date", exact: true }).click();
  if (t.join("|") !== "Birthday gift|Buy groceries|Call the vet") throw new Error(t.join(", "));
  return t.join(", ");
});
await check("+ on Tasks opens a One-Off; saving makes a Task", async () => {
  await p.getByRole("button", { name: "Add" }).click();
  const sheet = p.getByRole("dialog").last();
  const once = await sheet.getByRole("button", { name: /^one-off$/i }).getAttribute("class");
  await sheet.getByPlaceholder("What needs doing?").fill("Renew passport");
  await sheet.getByRole("button", { name: /^Save$/ }).click();
  await row(p, "Renew passport").waitFor({ timeout: 3000 });
  const c = (lastCall("putItem")!.args as any).input;
  if (!once?.includes("on") || c.kind !== "task") throw new Error(`One-Off class=${once} kind=${c.kind}`);
  return "One-Off preselected, kind=task, listed on Tasks";
});
await check("Done takes a Task off the Tasks tab", async () => {
  await row(p, "Call the vet").getByRole("button", { name: /Mark Call the vet done/ }).click();
  await row(p, "Call the vet").waitFor({ state: "detached", timeout: 3000 });
});
await check("+ on On track still opens a Chore (Every N)", async () => {
  await tab(p, "On track");
  await p.getByRole("button", { name: "Add" }).click();
  const cls = await p.getByRole("dialog").last().locator(".seg button", { hasText: "Every N" }).getAttribute("class");
  await p.getByRole("dialog").last().getByRole("button", { name: "Cancel" }).click();
  if (!cls?.includes("on")) throw new Error(`Every N class=${cls}`);
});

const failed = report();
await app.close();
process.exit(failed ? 1 : 0);
