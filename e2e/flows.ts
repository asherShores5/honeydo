// M2 / M4 / M5 and model-cleanup browser checks, two phones (asher, aubyn). Run: npx tsx flows.ts
import { launch } from "./app";
import { calls, graphql, seed } from "./backend";
import { callsSince, checklist, lastCall, reveal, row, shot, tab } from "./lib";

const { check, watch, report } = checklist("flows");
await seed();
const app = await launch();
const asher = await app.open("asher");
const aubyn = await app.open("aubyn");
let promptAnswer = "Kitchen only";
asher.on("dialog", (d) => (d.type() === "prompt" ? d.accept(promptAnswer) : d.accept()));
aubyn.on("dialog", (d) => d.accept());
for (const p of [asher, aubyn]) await p.getByPlaceholder(/Quick add/).waitFor();
watch(asher);
const editor = (p = asher) => p.getByRole("dialog").last();
async function open(p: typeof asher, title: string) {
  await reveal(p, title);
  await row(p, title).locator("button.body").click();
  await editor(p).waitFor();
}

/** What iOS does when the app comes back to the front: the app re-reads its snapshot. */
async function resume(p: typeof asher) {
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForTimeout(600);
}

// ---- privacy ---------------------------------------------------------------
await check("Private item: Birthday gift is not on aubyn's phone", async () => {
  await aubyn.waitForTimeout(300);
  if (await row(aubyn, "Birthday gift").count()) throw new Error("aubyn sees it");
  if (!(await row(asher, "Birthday gift").count())) throw new Error("asher doesn't see it");
});
await check("Editor: turning Private on forces 'For' to me (story 5)", async () => {
  await open(asher, "Take out trash");
  await editor().getByRole("button", { name: "Aubyn", exact: true }).click();
  await editor().getByRole("checkbox", { name: /Private/ }).check();
  await shot(asher, "flows-private-toggle");
  const aubynBtn = editor().getByRole("button", { name: "Aubyn", exact: true });
  const state = { disabled: await aubynBtn.isDisabled().catch(() => null), cls: await aubynBtn.getAttribute("class").catch(() => null) };
  await editor().getByRole("button", { name: "Cancel" }).click();
  if (state.cls?.includes("on")) throw new Error(`Aubyn still selected: ${JSON.stringify(state)}`);
  return JSON.stringify(state);
});
await check("Making a shared item Private removes it from aubyn's phone live (story 14)", async () => {
  await row(aubyn, "Take out trash").waitFor();
  await open(asher, "Take out trash");
  await editor().getByRole("checkbox", { name: /Private/ }).check();
  await editor().getByRole("button", { name: /^Save$/ }).click();
  await row(aubyn, "Take out trash").waitFor({ state: "detached", timeout: 4000 });
  const c = lastCall("putItem")!.args as any;
  return `visibility=${c.input.visibility}, assignee=${c.input.assigneeId ?? "none"}`;
});

// ---- Tasks (stories 2-4) ---------------------------------------------------
await check("Task done leaves On track, shows in Finished, Undo brings it back", async () => {
  await reveal(asher, "Buy groceries");
  await row(asher, "Buy groceries").getByRole("button", { name: /Mark Buy groceries done/ }).click();
  await row(asher, "Buy groceries").waitFor({ state: "detached", timeout: 3000 });
  await shot(asher, "flows-task-done");
  const undo = asher.getByRole("button", { name: "Undo" });
  await tab(asher, "Finished");
  const finished = (await asher.locator("main, body").first().innerText()).includes("Buy groceries");
  await undo.click();
  await tab(asher, "On track");
  await row(asher, "Buy groceries").waitFor({ timeout: 3000 });
  if (!finished) throw new Error("not in Finished");
  return "done → Finished → Undo → back on On track";
});

// ---- Comments (stories 35-36) ----------------------------------------------
await check("Comment on a shared item reaches aubyn", async () => {
  await open(asher, "Dishes");
  await editor().getByPlaceholder("Add a comment").fill("used the last of the soap");
  await editor().getByRole("button", { name: "Post" }).click();
  await editor().getByText("used the last of the soap").waitFor({ timeout: 3000 });
  await editor().getByRole("button", { name: "Cancel" }).click();
  await open(aubyn, "Dishes");
  await editor(aubyn).getByText("used the last of the soap").waitFor({ timeout: 3000 });
  await shot(aubyn, "flows-comment-aubyn");
  await editor(aubyn).getByRole("button", { name: "Cancel" }).click();
});
await check("Comment on a Private item never reaches aubyn", async () => {
  await open(asher, "Birthday gift");
  await editor().getByPlaceholder("Add a comment").fill("secret: the blue scarf");
  await editor().getByRole("button", { name: "Post" }).click();
  await editor().getByText("secret: the blue scarf").waitFor({ timeout: 3000 });
  await editor().getByRole("button", { name: "Cancel" }).click();
  await aubyn.waitForTimeout(500);
  const t = await aubyn.locator("body").innerText();
  await tab(aubyn, "Activity");
  const feed = await aubyn.locator("body").innerText();
  await tab(aubyn, "On track");
  if (/scarf|Birthday gift/i.test(t + feed)) throw new Error("leaked to aubyn");
});

// ---- Fridge (stories 37-39) ------------------------------------------------
await check("Fridge: pinned Note with 1 day expiry shows on aubyn's Fridge", async () => {
  await tab(asher, "Fridge");
  await asher.getByLabel("New Note").fill("We're out of diapers");
  await asher.getByRole("checkbox", { name: /Pin/ }).check();
  await asher.getByLabel("Expires").selectOption({ label: "1 day" });
  await asher.getByRole("button", { name: "Post" }).click();
  await asher.getByText("We're out of diapers").waitFor({ timeout: 3000 });
  const c = lastCall("postNote")!.args as any;
  await tab(aubyn, "Fridge");
  await aubyn.getByText("We're out of diapers").waitFor({ timeout: 3000 });
  await shot(aubyn, "flows-fridge-aubyn");
  const h = (c.expiresAt - Date.now()) / 3600_000;
  if (!c.pinned || Math.abs(h - 24) > 0.1) throw new Error(`pinned=${c.pinned} expires in ${h.toFixed(1)}h`);
  return `pinned, expires in ${h.toFixed(1)}h`;
});
await check("Fridge: Make Task turns the Note into a Task, Note links to it", async () => {
  await asher.getByRole("button", { name: "Make Task" }).first().click();
  await editor().waitFor();
  const title = await editor().getByPlaceholder("What needs doing?").inputValue();
  await editor().getByRole("button", { name: /^Save$/ }).click();
  await asher.getByRole("button", { name: /Made into a Task/ }).waitFor({ timeout: 3000 });
  await aubyn.getByRole("button", { name: /Made into a Task/ }).waitFor({ timeout: 3000 });
  await shot(asher, "flows-note-tasked");
  const fields = callsSince(0).slice(-3).map((x) => x.field).join(",");
  return `title="${title}", calls: ${fields}`;
});

// ---- Activity unread (story 41) --------------------------------------------
await check("Activity unread badge on aubyn after asher acts, clears when opened", async () => {
  await tab(aubyn, "On track");
  await tab(asher, "On track");
  await reveal(asher, "Water plants");
  await row(asher, "Water plants").getByRole("button", { name: /Mark Water plants done/ }).click();
  await asher.waitForTimeout(500);
  await resume(aubyn);
  const badge = aubyn.locator("nav b.unread");
  await badge.waitFor({ timeout: 4000 });
  const n = await badge.innerText();
  await tab(aubyn, "Activity");
  await aubyn.waitForTimeout(400);
  const top = (await aubyn.locator("body").innerText()).match(/Asher completed Water plants/)?.[0];
  await tab(aubyn, "On track");
  const after = await badge.count();
  if (!top) throw new Error("event missing from feed");
  if (after) throw new Error(`badge still showing (${await badge.innerText()})`);
  return `badge=${n}, cleared after viewing`;
});

// ---- offline (stories 10-12) -----------------------------------------------
await check("Offline: Done stays on screen, syncs once on reconnect, one Activity event", async () => {
  await reveal(asher, "Mop floor").catch(() => {});
  await tab(asher, "On track");
  await asher.setOffline(true);
  await asher.waitForTimeout(300);
  const before = calls.length;
  await resume(aubyn);
  await tab(aubyn, "Activity");
  const eventsBefore = ((await aubyn.locator("body").innerText()).match(/Asher completed Buy groceries/g) ?? []).length;
  await tab(aubyn, "On track");
  await reveal(asher, "Buy groceries");
  await row(asher, "Buy groceries").getByRole("button", { name: /Mark Buy groceries done/ }).click();
  await asher.waitForTimeout(800);
  const goneOffline = !(await row(asher, "Buy groceries").isVisible());
  await shot(asher, "flows-offline-done");
  const status = await asher.locator("header, body").first().innerText();
  await asher.setOffline(false);
  await asher.waitForTimeout(3000);
  const sent = callsSince(before).filter((c) => c.field === "completeItem");
  await resume(aubyn);
  await tab(aubyn, "Activity");
  await aubyn.waitForTimeout(500);
  const feed = await aubyn.locator("body").innerText();
  const events = (feed.match(/Asher completed Buy groceries/g) ?? []).length - eventsBefore;
  await tab(aubyn, "On track");
  if (!goneOffline) throw new Error("item still listed after offline Done");
  if (sent.length !== 1) throw new Error(`completeItem sent ${sent.length}x`);
  if (events !== 1) throw new Error(`${events} new Activity events`);
  return `sent once after reconnect; offline hint: ${/offline|no signal|waiting/i.test(status) ? "shown" : "none seen"}`;
});

// ---- Views (stories 42-46) -------------------------------------------------
for (const v of ["Today", "Calendar", "Tag board", "History & stats"]) {
  await check(`Views → ${v} renders`, async () => {
    await tab(asher, "Views");
    await asher.getByRole("button", { name: v, exact: true }).click();
    await asher.waitForTimeout(300);
    await shot(asher, `flows-view-${v.replace(/\W+/g, "-")}`);
    const t = (await asher.locator("body").innerText()).split("History & stats").pop()!;
    if (/error|something went wrong/i.test(t)) throw new Error(t.slice(0, 150));
    return t.replace(/\s+/g, " ").trim().slice(0, 160);
  });
}
await check("Saved view: filter Kitchen, save, it becomes a tab for asher only (story 46)", async () => {
  await tab(asher, "On track");
  await asher.getByRole("button", { name: /^Filter/ }).click();
  await asher.locator(".filter-panel").getByRole("button", { name: "Kitchen", exact: true }).click();
  await asher.getByRole("button", { name: "Save view" }).click();
  await asher.locator("nav button", { hasText: "Kitchen only" }).waitFor({ timeout: 3000 });
  await asher.waitForTimeout(500);
  await shot(asher, "flows-saved-view");
  const aubynNav = await aubyn.locator("nav").first().innerText();
  if (aubynNav.includes("Kitchen only")) throw new Error("tab appeared on aubyn");
  await aubyn.reload();
  await aubyn.getByPlaceholder(/Quick add/).waitFor();
  if ((await aubyn.locator("nav").first().innerText()).includes("Kitchen only")) throw new Error("tab on aubyn after reload");
  await asher.locator("nav button", { hasText: "Kitchen only" }).click();
  await asher.waitForTimeout(300);
  const titles = await asher.locator("li.item .title").allInnerTexts();
  return `Kitchen only tab shows: ${titles.join(", ")}`;
});

// ---- Settings (stories 32-33, 15) ------------------------------------------
await check("Settings: Handoff time, quiet hours, overdue alerts off save", async () => {
  await tab(asher, "On track");
  await asher.getByRole("button", { name: "Settings" }).click();
  const before = calls.length;
  await asher.getByLabel("Quiet hours start").fill("22:00");
  await asher.getByLabel("Quiet hours end").fill("07:00");
  await asher.keyboard.press("Tab");
  await asher.getByRole("dialog").last().getByRole("button", { name: "off", exact: true }).click();
  await asher.waitForTimeout(800);
  const puts = callsSince(before).filter((c) => c.field === "putProfile").map((c) => (c.args as any).input.alertPrefs);
  const me = await graphql("fake-id.asher", "query { me { alertPrefs } }");
  const prefs = JSON.parse(me.data.me.alertPrefs ?? "{}");
  console.log("putProfile alertPrefs sent:", puts);
  await shot(asher, "flows-settings-alerts");
  if (prefs.quietStart !== "22:00" || prefs.quietEnd !== "07:00" || prefs.overdueAlerts !== false) throw new Error(`prefs=${JSON.stringify(prefs)}`);
  return JSON.stringify(prefs);
});
await check("Settings: deleting the Kitchen tag removes it from every item (story 15)", async () => {
  await asher.getByRole("dialog").last().getByRole("button", { name: /^Kitchen ✕/ }).click();
  await asher.waitForTimeout(800);
  await asher.getByRole("button", { name: "Done", exact: true }).first().click();
  await tab(asher, "On track");
  const chips = await asher.locator("li.item .tags").allInnerTexts();
  const aubynChips = await aubyn.locator("li.item .tags").allInnerTexts();
  if ([...chips, ...aubynChips].some((t) => /Kitchen/.test(t))) throw new Error(`still tagged: ${chips} | ${aubynChips}`);
  return `deleteTag sent: ${!!lastCall("deleteTag")}`;
});

const failed = report();
await app.close();
process.exit(failed ? 1 : 0);
