// Opens the built web app (web/dist) in headless Chromium with every network call routed to
// the fake backend. Build first: npm run build:web (from the repo root).
//
//   const app = await launch();
//   const asher = await app.open("asher");          // signed in, Home loaded
//   const aubyn = await app.open("aubyn");          // a second phone, live updates between them
//   await asher.screenshot({ path: "/tmp/e2e/home.png" });
//   await app.close();
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type Browser, type Page } from "playwright";
import { parse } from "graphql";
import { MEMBERS, cognito, graphql, memberForToken, subscribe, subscriptionField } from "./backend";

export const ORIGIN = "https://honeydo.test";
const GRAPHQL_URL = "https://e2e.appsync-api.us-west-1.amazonaws.com/graphql";
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");

const CONFIG = {
  region: "us-west-1",
  userPoolId: "us-west-1_e2e",
  clientId: "e2e-client",
  graphqlUrl: GRAPHQL_URL,
  usernames: Object.keys(MEMBERS),
  passkeyDomain: "honeydo.test",
};

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};

export interface OpenOptions {
  /** Start signed out (to test the sign-in screen). */
  signedOut?: boolean;
  /** Fixed clock for the page (ms since epoch). */
  now?: number;
}

export async function launch() {
  if (!existsSync(path.join(DIST, "index.html"))) throw new Error("web/dist missing: run npm run build:web first");
  const browser: Browser = await chromium.launch();
  const pages: Page[] = [];

  async function open(username: string, opts: OpenOptions = {}) {
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block", timezoneId: "America/Los_Angeles" });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log(`[${username}] pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") console.log(`[${username}] console: ${m.text()}`); });
    if (opts.now !== undefined) await page.clock.install({ time: opts.now });

    if (!opts.signedOut) {
      await context.addInitScript((u) => {
        if (localStorage.getItem("aubi.tokens")) return;
        localStorage.setItem("aubi.tokens", JSON.stringify({
          idToken: `fake-id.${u}`, accessToken: `fake-access.${u}`, refreshToken: `fake-refresh.${u}`,
          expiresAt: Date.now() + 3600_000, username: u,
        }));
        localStorage.setItem("aubi.lastUser", u);
      }, username);
    }

    await context.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/config.json") return route.fulfill({ json: CONFIG });
      let file = path.join(DIST, decodeURIComponent(url.pathname));
      if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === "/") file = path.join(DIST, "index.html");
      return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] ?? "application/octet-stream" });
    });
    await context.route("https://cognito-idp.us-west-1.amazonaws.com/", async (route) => {
      const target = (route.request().headers()["x-amz-target"] ?? "").split(".").pop()!;
      const r = cognito(target, route.request().postDataJSON());
      return route.fulfill({ status: r.status, contentType: "application/x-amz-json-1.1", body: JSON.stringify(r.json) });
    });
    await context.route(GRAPHQL_URL, async (route) => {
      const { query, variables } = route.request().postDataJSON();
      const json = await graphql(route.request().headers()["authorization"], query, variables);
      return route.fulfill({ json });
    });
    await context.routeWebSocket(/appsync-realtime-api/, (ws) => {
      const header = JSON.parse(atob(new URL(ws.url()).searchParams.get("header") ?? "e30="));
      const member = memberForToken(header.Authorization);
      const unsubs = new Map<string, () => void>();
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "connection_init") {
          if (!member) return ws.send(JSON.stringify({ type: "connection_error" }));
          ws.send(JSON.stringify({ type: "connection_ack", payload: { connectionTimeoutMs: 300_000 } }));
        } else if (msg.type === "start" && member) {
          const doc = parse(JSON.parse(msg.payload.data).query);
          const field = subscriptionField(doc)!;
          unsubs.set(msg.id, subscribe({ member, field, doc, send: (data) => ws.send(JSON.stringify({ id: msg.id, type: "data", payload: { data } })) }));
          ws.send(JSON.stringify({ id: msg.id, type: "start_ack" }));
        } else if (msg.type === "stop") {
          unsubs.get(msg.id)?.();
        }
      });
      ws.onClose(() => unsubs.forEach((u) => u()));
    });

    await page.goto(ORIGIN + "/");
    pages.push(page);
    return page;
  }

  return { browser, open, close: () => browser.close() };
}
