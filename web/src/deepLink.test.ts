import { describe, expect, it } from "vitest";
import { clickPlan, itemIdFromUrl, notificationFor, withoutItemParam } from "./deepLink";

describe("the ?item= deep link a Ding opens", () => {
  it("reads the item ID, decoding it", () => {
    expect(itemIdFromUrl("https://honey.example/?item=abc-123")).toBe("abc-123");
    expect(itemIdFromUrl("https://honey.example/?item=a%2Fb")).toBe("a/b");
  });

  it("has no item ID when the param is missing or empty", () => {
    expect(itemIdFromUrl("https://honey.example/")).toBeUndefined();
    expect(itemIdFromUrl("https://honey.example/?item=")).toBeUndefined();
  });

  it("clears the param and keeps the rest of the URL", () => {
    expect(withoutItemParam("https://honey.example/?item=abc")).toBe("/");
    expect(withoutItemParam("https://honey.example/?x=1&item=abc#top")).toBe("/?x=1#top");
  });
});

describe("the notification the worker shows for a push", () => {
  const ding = JSON.stringify({ title: "Bins out", body: "Overdue by 2 hours", data: { kind: "ding", itemId: "i1", url: "/?item=i1" } });

  it("shows a Ding's title and body, carrying the deep link", () => {
    expect(notificationFor(ding)).toEqual({
      title: "Bins out",
      options: { body: "Overdue by 2 hours", data: { url: "/?item=i1" }, tag: "ding-i1", icon: "/icon-192.png" },
    });
  });

  it("shows a Handoff with its link and no item tag", () => {
    const handoff = JSON.stringify({ title: "Today", body: "3 due", data: { kind: "handoff", url: "/" } });
    expect(notificationFor(handoff)).toEqual({ title: "Today", options: { body: "3 due", data: { url: "/" }, icon: "/icon-192.png" } });
  });

  // iOS revokes the subscription of a worker that gets a push and shows nothing.
  it.each([["no payload", undefined], ["not JSON", "{oops"], ["no title", JSON.stringify({ body: "x" })], ["JSON null", "null"]])(
    "still shows a generic notification for %s",
    (_, raw) => {
      expect(notificationFor(raw)).toEqual({ title: "Aubi Honey", options: { body: "Something needs you.", data: { url: "/" }, icon: "/icon-192.png" } });
    },
  );
});

describe("tapping a notification", () => {
  const origin = "https://honey.example";
  const app = (url: string, focused = false) => ({ url: origin + url, focused });

  it("opens a new window on the deep link when the app isn't open", () => {
    expect(clickPlan({ url: "/?item=i1" }, [], origin)).toEqual({ open: "https://honey.example/?item=i1" });
  });

  it("focuses the open app and tells it which item to open", () => {
    expect(clickPlan({ url: "/?item=i1" }, [app("/")], origin)).toEqual({ focus: 0, message: { type: "openItem", itemId: "i1" } });
  });

  it("prefers the focused app window, and ignores other origins", () => {
    const windows = [{ url: "https://other.example/", focused: true }, app("/"), app("/?x", true)];
    expect(clickPlan({ url: "/?item=i1" }, windows, origin)).toEqual({ focus: 2, message: { type: "openItem", itemId: "i1" } });
  });

  it("just focuses the app for a link with no item (a Handoff)", () => {
    expect(clickPlan({ url: "/" }, [app("/")], origin)).toEqual({ focus: 0 });
  });

  it("never leaves the app's origin, whatever the payload says", () => {
    expect(clickPlan({ url: "https://evil.example/?item=i1" }, [], origin)).toEqual({ open: "https://honey.example/" });
    expect(clickPlan({ url: "//evil.example/" }, [], origin)).toEqual({ open: "https://honey.example/" });
    expect(clickPlan(undefined, [], origin)).toEqual({ open: "https://honey.example/" });
    expect(clickPlan({ url: 42 }, [], origin)).toEqual({ open: "https://honey.example/" });
  });
});
