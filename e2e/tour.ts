// Visual sweep: every screen on phone, desktop, and phone in dark theme. Screenshots in /tmp/e2e/tour-*.
import type { Page } from "playwright";
import { launch } from "./app";
import { graphql, seed } from "./backend";
import { reveal, row, shot, tab } from "./lib";

await seed();
await graphql("fake-id.asher", `mutation { postNote(id: "n1", text: "Pediatrician Tuesday 3pm, bring the shot record", pinned: true) { id } }`);
await graphql("fake-id.aubyn", `mutation { postNote(id: "n2", text: "We're out of diapers") { id } }`);
await graphql("fake-id.aubyn", `mutation { addComment(itemId: "dishes", id: "c1", text: "used the last of the soap") { visibility } }`);
const app = await launch();

async function sweep(p: Page, name: string) {
  const s = (n: string) => shot(p, `tour-${name}-${n}`);
  await p.getByPlaceholder(/Quick add/).waitFor();
  await p.waitForTimeout(400);
  await s("01-ontrack");
  for (const [t, n] of [["Overdue", "02-overdue"], ["Finished", "03-finished"], ["Activity", "04-activity"], ["Fridge", "05-fridge"]]) { await tab(p, t); await s(n); }
  await tab(p, "Views");
  for (const [v, n] of [["Today", "06-today"], ["Calendar", "07-calendar"], ["Tag board", "08-board"], ["History & stats", "09-stats"]]) {
    await p.getByRole("button", { name: v, exact: true }).click(); await p.waitForTimeout(300); await s(n);
  }
  await tab(p, "On track");
  await row(p, "Water plants").locator("button.body").click(); await p.waitForTimeout(300); await s("10-editor");
  await p.getByRole("dialog").last().evaluate((el) => el.querySelector(".sheet-body")?.scrollTo(0, 99999)); await p.waitForTimeout(200); await s("11-editor-bottom");
  await p.getByRole("button", { name: "Cancel" }).first().click();
  await reveal(p, "Dishes"); await row(p, "Dishes").locator("button.body").click(); await p.waitForTimeout(300);
  await p.getByRole("dialog").last().evaluate((el) => el.querySelector(".sheet-body")?.scrollTo(0, 99999)); await s("12-editor-comments");
  await p.getByRole("button", { name: "Cancel" }).first().click();
  await tab(p, "On track");
  await p.getByRole("button", { name: "Add" }).click(); await p.waitForTimeout(300); await s("13-new");
  await p.getByRole("button", { name: "Cancel" }).first().click();
  await p.getByRole("button", { name: "More for Take out trash" }).click(); await p.waitForTimeout(300); await s("14-rowactions");
  await p.getByRole("button", { name: "Cancel" }).first().click();
  await p.getByRole("button", { name: "Settings" }).click(); await p.waitForTimeout(400); await s("15-settings");
  await p.getByRole("dialog").last().evaluate((el) => el.querySelector(".sheet-body")?.scrollTo(0, 99999)); await s("16-settings-bottom");
}

await sweep(await app.open("asher"), "phone");
await sweep(await app.open("asher", { device: "desktop" }), "desktop");
await graphql("fake-id.aubyn", `mutation { putProfile(input: { theme: "dark" }) { theme } }`);
await sweep(await app.open("aubyn"), "dark");
const out = await app.open("asher", { signedOut: true });
await out.waitForTimeout(800); await shot(out, "tour-phone-00-login");
await app.close();
