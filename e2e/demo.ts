// Guest demo at /demo: the built app with NO fake backend routes. The demo must answer every
// call in the browser, never leave the origin, and leave a real Member's storage alone.
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";
import { checklist, reveal, row, shot, tab } from "./lib";

const ORIGIN = "https://honeydo.test";
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
if (!existsSync(path.join(DIST, "index.html"))) throw new Error("web/dist missing: run npm run build:web first");

const { check, watch, report } = checklist("demo");
const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
const offOrigin: string[] = [];
let configFetchesInDemo = 0;
let inDemo = false;
const REAL_CONFIG = { region: "us-west-1", userPoolId: "us-west-1_x", clientId: "x", graphqlUrl: "https://x.appsync-api.us-west-1.amazonaws.com/graphql", usernames: ["asher", "aubyn"] };
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) return inDemo && offOrigin.push(url.href), route.abort();
  if (url.pathname === "/config.json") return (inDemo && configFetchesInDemo++), route.fulfill({ json: REAL_CONFIG });
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === "/" || url.pathname.startsWith("/demo")) file = path.join(DIST, "index.html");
  return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream" });
});
await context.routeWebSocket(/.*/, (ws) => (inDemo && offOrigin.push(ws.url()), ws.close()));
const p = await context.newPage();
watch(p);
p.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));

// A real Member already signed in on this browser.
await p.goto(ORIGIN + "/");
const REAL = JSON.stringify({ idToken: "real", accessToken: "real", refreshToken: "real", expiresAt: 0, username: "asher" });
await p.evaluate((t) => localStorage.setItem("aubi.tokens", t), REAL);
inDemo = true;
const storage = () => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, Storage.prototype.getItem.call(localStorage, k)])));

await check("/demo opens straight into a seeded household, signed in as Sam", async () => {
  await p.goto(ORIGIN + "/demo");
  await p.getByRole("region", { name: "Demo" }).waitFor({ timeout: 5000 });
  await row(p, "Water plants").waitFor({ timeout: 5000 });
  await p.waitForTimeout(400);
  await shot(p, "demo-home");
  const banner = await p.getByRole("region", { name: "Demo" }).innerText();
  if (!/You're Sam/.test(banner)) throw new Error(banner);
  return banner.split("\n")[0];
});

await check("Overdue holds the seeded overdue Chores", async () => {
  await tab(p, "Overdue");
  await shot(p, "demo-overdue");
  const t = await p.locator("li.item .title").allInnerTexts();
  if (!t.some((x) => x.includes("Clean bathroom"))) throw new Error(t.join(", "));
  return `${t.length} overdue`;
});

await check("Done works, and survives a reload", async () => {
  await reveal(p, "Clean bathroom");
  await row(p, "Clean bathroom").getByRole("button", { name: /Mark Clean bathroom done/ }).click();
  await p.waitForTimeout(500);
  await p.reload();
  await p.getByRole("region", { name: "Demo" }).waitFor();
  await tab(p, "Overdue");
  if (await row(p, "Clean bathroom").isVisible()) throw new Error("still overdue after reload");
});

await check("Sam sees the Private gift; after Switch, Alex doesn't, and sees Sam's Done", async () => {
  await tab(p, "Tasks");
  if (!(await row(p, "Birthday present for Alex").isVisible())) throw new Error("Sam can't see own Private Task");
  await p.getByRole("button", { name: "Switch to Alex" }).click();
  await p.getByText("You're Alex").waitFor({ timeout: 5000 });
  await tab(p, "Tasks");
  await shot(p, "demo-alex-tasks");
  if (await row(p, "Birthday present for Alex").count()) throw new Error("Alex sees Sam's Private Task");
  await tab(p, "Activity");
  await shot(p, "demo-alex-activity");
  const text = await p.locator("main, body").first().innerText();
  if (!/Clean bathroom/.test(text)) throw new Error("no Clean bathroom in Activity");
});

await check("Settings has no passkeys or push; Exit demo is there", async () => {
  await p.getByRole("button", { name: /Settings/ }).click();
  const sheet = p.getByRole("dialog").last();
  await shot(p, "demo-settings");
  if (await sheet.getByText("Add a passkey").count()) throw new Error("passkey button shown");
  if (!(await sheet.getByText("Notifications are off in the demo").count())) throw new Error("no demo notifications note");
  await sheet.getByRole("button", { name: "Done" }).click();
});

await check("Exit demo leaves only the real Member's keys, untouched", async () => {
  await p.getByRole("region", { name: "Demo" }).getByRole("button", { name: "Exit demo" }).click();
  await p.waitForURL(ORIGIN + "/");
  inDemo = false;
  const s = await storage();
  const session = await p.evaluate(() => Object.keys(sessionStorage));
  if (s["aubi.tokens"] !== REAL || Object.keys(s).some((k) => k.startsWith("demo:"))) throw new Error(JSON.stringify(s));
  if (session.length) throw new Error(`sessionStorage left: ${session.join(", ")}`);
});

await check("Sign-in page links to the demo", async () => {
  await p.evaluate(() => localStorage.clear());
  await p.goto(ORIGIN + "/");
  const link = p.getByRole("link", { name: /Try the demo household/ });
  await link.waitFor({ timeout: 5000 });
  await shot(p, "demo-login");
  if ((await link.getAttribute("href")) !== "/demo") throw new Error(String(await link.getAttribute("href")));
});

await check("While in the demo, nothing left the origin and the real config was never fetched", async () => {
  if (offOrigin.length) throw new Error(offOrigin.join(", "));
  if (configFetchesInDemo) throw new Error(`${configFetchesInDemo} config fetches`);
});

const failed = report();
await browser.close();
process.exit(failed ? 1 : 0);
