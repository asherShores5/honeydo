// Seam 2 test harness: call the real Lambda handler as either Member against an in-memory table.
//
//   const h = harness();
//   beforeEach(() => h.reset());
//   await h.call(h.A, "putItem", { input });
//   const snap = await h.call(h.B, "snapshot");
//
// handler.ts reads TABLE_NAME / ALLOWED_USERNAMES at import time, so tests must import the
// handler through this module (never statically) for the env below to take effect.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";
import { FakeDocClient } from "./fakeDynamo";

export interface Member {
  userId: string;
  username: string;
}

export const memberA: Member = { userId: "sub-a", username: "member-a" };
export const memberB: Member = { userId: "sub-b", username: "member-b" };

process.env.TABLE_NAME = "test-table";
process.env.ALLOWED_USERNAMES = `${memberA.username},${memberB.username}`;

const { handler, setDocClient } = await import("../handler");

const db = new FakeDocClient();
setDocClient(db);

/** AppSync-shaped resolver event for one Member calling one field. */
export function appSyncEvent(member: Member, fieldName: string, args: Record<string, unknown> = {}) {
  const identity = {
    sub: member.userId,
    username: member.username,
    claims: { sub: member.userId, "cognito:username": member.username },
    issuer: "test", sourceIp: [], defaultAuthStrategy: "ALLOW", groups: null,
  } satisfies AppSyncIdentityCognito;
  const parentTypeName = ["me", "snapshot", "completions"].includes(fieldName) ? "Query" : "Mutation";
  return {
    arguments: args,
    identity,
    source: null,
    request: { headers: {}, domainName: null },
    info: { fieldName, parentTypeName, variables: args, selectionSetList: [], selectionSetGraphQL: "" },
    prev: null,
    stash: {},
  } as AppSyncResolverEvent<Record<string, unknown>>;
}

/**
 * Whether an onItemChange subscriber receives this mutation result. Mirrors the subscription
 * filter in infra/lib/stacks.ts ("SubItems" resolver): visibility in ["shared", "private:<sub>"],
 * or removedFor contains <sub> (an item that just went Private, delivered as a removal).
 * Mutations publish by returning the ItemChange envelope; there is no other publish path.
 */
export function deliveredTo(change: { visibility: string; removedFor?: string[] | null }, member: Member) {
  return (
    ["shared", `private:${member.userId}`].includes(change.visibility) ||
    (change.removedFor ?? []).includes(member.userId)
  );
}

export function harness() {
  return {
    A: memberA,
    B: memberB,
    db,
    /** Empty the table. */
    reset: () => db.reset(),
    event: appSyncEvent,
    /** Invoke the handler as `member`. Rejects with the same Error the client would see. */
    call: (member: Member, fieldName: string, args: Record<string, unknown> = {}): Promise<any> =>
      handler(appSyncEvent(member, fieldName, args)),
    deliveredTo,
  };
}
