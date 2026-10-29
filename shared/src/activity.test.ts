import { describe, expect, it } from "vitest";
import { unreadActivity } from "./activity";

const ev = (id: string, at: number, by: string) => ({ id, at, by });

describe("unread Activity", () => {
  const feed = [ev("e3", 300, "b"), ev("e2", 200, "a"), ev("e1", 100, "b")];

  it("counts the partner's events newer than last seen", () => {
    expect(unreadActivity(feed, "a", 150)).toBe(1);
  });

  it("doesn't count my own actions", () => {
    expect(unreadActivity(feed, "a", 50)).toBe(2);
    expect(unreadActivity(feed, "b", 50)).toBe(1);
  });

  it("an event at exactly last seen is read", () => {
    expect(unreadActivity(feed, "a", 300)).toBe(0);
  });

  it("nothing is unread once last seen is past the newest event", () => {
    expect(unreadActivity(feed, "a", 1_000)).toBe(0);
  });

  it("never opened: every event by someone else is unread", () => {
    expect(unreadActivity(feed, "a", null)).toBe(2);
    expect(unreadActivity(feed, "a", undefined)).toBe(2);
  });

  it("an empty feed has nothing unread", () => {
    expect(unreadActivity([], "a", null)).toBe(0);
  });
});
