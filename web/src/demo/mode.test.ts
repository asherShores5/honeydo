import { describe, expect, it } from "vitest";
import { DEMO_FLAG, clearDemoKeys, demoActive, demoRequested, isolateStorage } from "./mode";

/** Map-backed stand-in for the browser's Storage (the methods the app and the demo use). */
class MemStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

describe("demoRequested", () => {
  it("is the /demo path, with or without a trailing slash or query", () => {
    expect(demoRequested("https://honeydo.ashershores.com/demo")).toBe(true);
    expect(demoRequested("https://honeydo.ashershores.com/demo/?x=1")).toBe(true);
    expect(demoRequested("https://honeydo.ashershores.com/")).toBe(false);
    expect(demoRequested("https://honeydo.ashershores.com/?item=demo")).toBe(false);
    expect(demoRequested("https://honeydo.ashershores.com/demolition")).toBe(false);
  });
});

describe("demoActive", () => {
  it("stays on for the tab after entering at /demo, until the demo keys are cleared", () => {
    class Tab extends MemStorage {}
    const session = new Tab();
    expect(demoActive("https://h.test/", session)).toBe(false);
    const restore = isolateStorage(Tab.prototype);
    session.setItem(DEMO_FLAG, "1"); // what boot does on entry, with the patch on
    restore();
    expect(demoActive("https://h.test/", session)).toBe(true);
    clearDemoKeys(session);
    expect(demoActive("https://h.test/", session)).toBe(false);
  });
});

describe("isolateStorage", () => {
  class Real extends MemStorage {}
  const real = new Real();
  real.setItem("aubi.tokens", "REAL MEMBER TOKENS");
  const restore = isolateStorage(Real.prototype);

  it("hides a signed-in Member's keys from the demo", () => {
    expect(real.getItem("aubi.tokens")).toBeNull();
  });

  it("never overwrites or removes the Member's keys", () => {
    real.setItem("aubi.tokens", "demo tokens");
    expect(real.getItem("aubi.tokens")).toBe("demo tokens");
    real.removeItem("aubi.tokens");
    expect(real.map.get("aubi.tokens")).toBe("REAL MEMBER TOKENS");
  });

  it("clearDemoKeys drops only demo keys, and restore puts the real view back", () => {
    real.setItem("aubi.cache.v1", "{}");
    clearDemoKeys(real);
    restore();
    expect([...real.map.keys()]).toEqual(["aubi.tokens"]);
    expect(real.getItem("aubi.tokens")).toBe("REAL MEMBER TOKENS");
  });
});
