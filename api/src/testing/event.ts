// AppSync-shaped resolver event for one Member calling one field. No side effects, so the
// browser demo (web/src/demo) can build events without the test harness's env setup.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from "aws-lambda";

export interface Member {
  userId: string;
  username: string;
}

export function appSyncEvent(member: Member, fieldName: string, args: Record<string, unknown> = {}) {
  const identity = {
    sub: member.userId,
    username: member.username,
    claims: { sub: member.userId, "cognito:username": member.username },
    issuer: "test", sourceIp: [], defaultAuthStrategy: "ALLOW", groups: null,
  } satisfies AppSyncIdentityCognito;
  const parentTypeName = ["me", "snapshot", "completions", "comments"].includes(fieldName) ? "Query" : "Mutation";
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

