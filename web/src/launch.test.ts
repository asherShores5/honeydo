import { describe, expect, it } from "vitest";
import { showCachedFirst } from "./launch";

describe("showCachedFirst", () => {
  it("shows the cached snapshot right away when it belongs to the signed-in Member", () => {
    expect(showCachedFirst({ username: "asher" }, "asher")).toBe(true);
  });

  it("waits for the server on a first launch (nothing cached)", () => {
    expect(showCachedFirst(undefined, "asher")).toBe(false);
  });

  it("never shows another Member's cache (sign-out, then the partner signs in on this phone)", () => {
    expect(showCachedFirst({ username: "aubyn" }, "asher")).toBe(false);
    expect(showCachedFirst({ username: "aubyn" }, undefined)).toBe(false);
  });
});
