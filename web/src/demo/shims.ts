// Turns this tab into the guest demo: demo-only storage, a signed-in demo Member, and every
// network call the app makes (config, Cognito, AppSync, realtime) answered in the browser by
// backend.ts. Anything else that leaves this origin is refused, so the demo can never reach AWS.
import type { Config } from "../config";
import type { DemoBackend } from "./backend";
import { DEMO_MEMBERS, tokenFor } from "./members";
import { DB_KEY, DEMO_FLAG, clearDemoKeys, isolateStorage } from "./mode";

const GRAPHQL_URL = "https://demo.appsync-api.invalid/graphql";
const COGNITO_URL = "https://cognito-idp.demo.amazonaws.com/";

const CONFIG: Config = {
  region: "demo", // so auth.ts calls COGNITO_URL
  userPoolId: "demo",
  clientId: "demo",
  graphqlUrl: GRAPHQL_URL,
  usernames: Object.keys(DEMO_MEMBERS),
  // No vapidPublicKey: Enable notifications shows as unsupported, so nothing subscribes to push.
};

const TOKENS = "aubi.tokens";
const CACHE_KEYS = ["aubi.cache.v1", "aubi.outbox.v1"];
const TEN_YEARS = 10 * 365 * 86_400_000;

let backend: Promise<DemoBackend> | undefined;
const getBackend = () =>
  (backend ??= import("./backend").then(({ createDemoBackend }) => createDemoBackend({ store: sessionStorage })));

/** Sign this tab in as a demo Member (written with the storage patch on). */
function signInAs(username: string) {
  localStorage.setItem(TOKENS, JSON.stringify({
    idToken: tokenFor(username), accessToken: `demo-access.${username}`, refreshToken: `demo-refresh.${username}`,
    expiresAt: Date.now() + TEN_YEARS, username,
  }));
  localStorage.setItem("aubi.lastUser", username);
}

export function installDemo() {
  isolateStorage(Storage.prototype);
  sessionStorage.setItem(DEMO_FLAG, "1");
  if (!localStorage.getItem(TOKENS)) signInAs("sam");

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const body = () => JSON.parse(String(init?.body ?? "{}"));
    const header = (name: string) => new Headers(init?.headers).get(name) ?? undefined;
    if (new URL(url, location.href).pathname === "/config.json") return json(200, CONFIG);
    if (url === COGNITO_URL) {
      const r = (await getBackend()).cognito(header("X-Amz-Target")?.split(".").pop() ?? "", body());
      return json(r.status, r.json);
    }
    if (url === GRAPHQL_URL) {
      const { query, variables } = body();
      return json(200, await (await getBackend()).graphql(header("Authorization"), query, variables));
    }
    if (new URL(url, location.href).origin !== location.origin) throw new TypeError(`blocked in the demo: ${url}`);
    return realFetch(input, init);
  };

  const RealSocket = window.WebSocket;
  window.WebSocket = class extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    private token?: string;
    private subs = new Map<string, () => void>();

    constructor(url: string | URL, protocols?: string | string[]) {
      super();
      const u = new URL(url);
      if (!u.host.endsWith("appsync-realtime-api.invalid")) {
        if (u.origin.replace(/^ws/, "http") !== location.origin) throw new DOMException(`blocked in the demo: ${u.href}`, "SecurityError");
        return new RealSocket(url, protocols) as never;
      }
      this.token = JSON.parse(atob(u.searchParams.get("header") ?? "e30=")).Authorization;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.(new Event("open"));
      });
    }

    private reply(msg: object) {
      setTimeout(() => this.readyState === 1 && this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(msg) })));
    }

    send(raw: string) {
      const msg = JSON.parse(raw);
      if (msg.type === "connection_init") this.reply({ type: "connection_ack", payload: { connectionTimeoutMs: 300_000 } });
      else if (msg.type === "start") {
        void getBackend().then((b) => {
          const off = b.subscribe(this.token, JSON.parse(msg.payload.data).query, (data) => this.reply({ id: msg.id, type: "data", payload: { data } }));
          if (off) this.subs.set(msg.id, off);
          this.reply(off ? { id: msg.id, type: "start_ack" } : { id: msg.id, type: "error" });
        });
      } else if (msg.type === "stop") this.subs.get(msg.id)?.();
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.subs.forEach((off) => off());
      setTimeout(() => this.onclose?.(new CloseEvent("close")));
    }
  } as unknown as typeof WebSocket;
}

/** Start the demo over: a fresh household, signed in as Sam. */
export function resetDemo() {
  clearDemoKeys(localStorage);
  sessionStorage.removeItem(DB_KEY);
  location.reload();
}

/** Become the other person in the household, keeping everything done so far. */
export function switchTo(username: string) {
  for (const k of CACHE_KEYS) localStorage.removeItem(k);
  signInAs(username);
  location.reload();
}

/** Leave the demo: drop every demo key in this tab and open the real sign-in page. */
export function exitDemo() {
  clearDemoKeys(localStorage);
  clearDemoKeys(sessionStorage);
  location.href = "/";
}
