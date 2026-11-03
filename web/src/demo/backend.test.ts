import { describe, expect, it, vi } from "vitest";

const { MemStorage } = vi.hoisted(() => {
  class MemStorage {
    map = new Map<string, string>();
    getItem(k: string) { return this.map.get(k) ?? null; }
    setItem(k: string, v: string) { this.map.set(k, v); }
    removeItem(k: string) { this.map.delete(k); }
  }
  // api.ts imports auth.ts, which reads localStorage on load. The queries are what's under test.
  (globalThis as any).localStorage = new MemStorage();
  return { MemStorage };
});

import { Q } from "../api";
import { createDemoBackend } from "./backend";
import { tokenFor } from "./members";
import { DB_KEY } from "./mode";

const NOW = Date.UTC(2026, 10, 3, 20); // Tue Nov 3 2026, noon Pacific
const SAM = tokenFor("sam");
const ALEX = tokenFor("alex");

describe("demo backend", () => {
  it("starts with a set-up household: both people, Tags, Chores and Tasks", async () => {
    const b = await createDemoBackend({ store: new MemStorage(), now: NOW });
    const { data } = await b.graphql(SAM, Q.snapshot);
    const s = data.snapshot;
    expect(s.profiles.map((p: any) => p.displayName).sort()).toEqual(["Alex", "Sam"]);
    expect(s.profiles.every((p: any) => p.setupComplete)).toBe(true);
    expect(s.tags.length).toBeGreaterThan(2);
    expect(s.items.some((i: any) => i.kind === "chore")).toBe(true);
    expect(s.items.some((i: any) => i.kind === "task")).toBe(true);
    expect(s.feed.length).toBeGreaterThan(0);
  });

  it("keeps Sam's Private item from Alex", async () => {
    const b = await createDemoBackend({ store: new MemStorage(), now: NOW });
    const titles = async (t: string) => (await b.graphql(t, Q.snapshot)).data.snapshot.items.map((i: any) => i.title);
    expect(await titles(SAM)).toContain("Birthday present for Alex");
    expect(await titles(ALEX)).not.toContain("Birthday present for Alex");
  });

  it("delivers Sam's changes live to Alex, but not Sam's Private ones", async () => {
    const b = await createDemoBackend({ store: new MemStorage(), now: NOW });
    const got: any[] = [];
    b.subscribe(ALEX, Q.onItemChange, (d) => got.push(d));
    const input = { id: "new-1", kind: "task", title: "Call the landlord", tags: [], visibility: "shared", archived: false };
    await b.graphql(SAM, Q.putItem, { input });
    await b.graphql(SAM, Q.putItem, { input: { ...input, id: "new-2", title: "Secret", visibility: "private:demo-sam" } });
    expect(got.map((d) => d.onItemChange.item.title)).toEqual(["Call the landlord"]);
  });

  it("survives a reload from the same store; without it, starts over from the seed", async () => {
    const store = new MemStorage();
    const first = await createDemoBackend({ store, now: NOW });
    await first.graphql(SAM, Q.putItem, { input: { id: "new-1", kind: "task", title: "Call the landlord", tags: [], visibility: "shared", archived: false } });
    const again = await createDemoBackend({ store });
    const titles = async () => (await again.graphql(ALEX, Q.snapshot)).data.snapshot.items.map((i: any) => i.title);
    expect(await titles()).toContain("Call the landlord");
    store.removeItem(DB_KEY); // what Reset does before reloading
    const fresh = await createDemoBackend({ store });
    const freshTitles = (await fresh.graphql(ALEX, Q.snapshot)).data.snapshot.items.map((i: any) => i.title);
    expect(freshTitles).not.toContain("Call the landlord");
    expect(freshTitles).toContain("Dishes");
  });

  it("refuses anything without a demo token, and real-looking Cognito calls", async () => {
    const b = await createDemoBackend({ store: new MemStorage(), now: NOW });
    expect((await b.graphql(undefined, Q.me)).errors?.[0].message).toBe("Unauthorized");
    expect((await b.graphql("eyJraWQiOi.real.jwt", Q.me)).errors?.[0].message).toBe("Unauthorized");
    expect((await b.graphql("demo-id.__proto__", Q.me)).errors?.[0].message).toBe("Unauthorized");
    expect((await b.graphql("demo-id.constructor", Q.me)).errors?.[0].message).toBe("Unauthorized");
    expect(b.subscribe("eyJraWQiOi.real.jwt", Q.onItemChange, () => {})).toBeUndefined();
    expect(b.cognito("StartWebAuthnRegistration", {}).status).toBe(400);
    expect(b.cognito("InitiateAuth", { AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: "demo-refresh.alex" } }).status).toBe(200);
  });

  it("starts over once the seed is half a day old, so its dates stay believable", async () => {
    const store = new MemStorage();
    const first = await createDemoBackend({ store, now: NOW });
    await first.graphql(SAM, Q.putItem, { input: { id: "new-1", kind: "task", title: "Call the landlord", tags: [], visibility: "shared", archived: false } });
    const titles = async (now: number) =>
      (await (await createDemoBackend({ store, now })).graphql(SAM, Q.snapshot)).data.snapshot.items.map((i: any) => i.title);
    expect(await titles(NOW + 11 * 3_600_000)).toContain("Call the landlord");
    expect(await titles(NOW + 13 * 3_600_000)).not.toContain("Call the landlord");
  });
});
