// Fake backend for browser checks: the real API handler on the in-memory table, behind a
// GraphQL executor built from schema/schema.graphql, plus just enough Cognito and AppSync
// realtime for the web app to run. Nothing here talks to AWS.
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GraphQLScalarType, Kind, buildSchema, defaultFieldResolver, execute, parse, valueFromASTUntyped,
  type DocumentNode, type GraphQLFieldResolver, type ValueNode,
} from "graphql";

export interface Member {
  userId: string;
  username: string;
}

export const MEMBERS: Record<string, Member> = {
  asher: { userId: "sub-asher", username: "asher" },
  aubyn: { userId: "sub-aubyn", username: "aubyn" },
};

// handler.ts reads these at import time, so import it only after setting them.
process.env.TABLE_NAME = "e2e-table";
process.env.ALLOWED_USERNAMES = Object.keys(MEMBERS).join(",");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { handler, setDocClient } = await import("../api/src/handler");
const { FakeDocClient } = await import("../api/src/testing/fakeDynamo");
const { appSyncEvent } = await import("../api/src/testing/harness");

export const db = new FakeDocClient();
setDocClient(db);

// AppSync supplies these; graphql-js needs them declared.
const AWSJSON = new GraphQLScalarType({
  name: "AWSJSON",
  serialize: (v) => (typeof v === "string" ? v : JSON.stringify(v)),
  parseValue: (v) => v,
  parseLiteral: (ast: ValueNode) => (ast.kind === Kind.STRING ? ast.value : valueFromASTUntyped(ast)),
});
const sdl = readFileSync(path.join(ROOT, "schema", "schema.graphql"), "utf8");
const schema = buildSchema(`scalar AWSJSON\ndirective @aws_subscribe(mutations: [String]) on FIELD_DEFINITION\n${sdl}`);
Object.assign(schema.getType("AWSJSON")!, { serialize: AWSJSON.serialize, parseValue: AWSJSON.parseValue, parseLiteral: AWSJSON.parseLiteral });

/** Subscription field -> the mutations that publish to it, read from @aws_subscribe. */
const PUBLISHERS = new Map<string, string[]>();
for (const f of Object.values(schema.getSubscriptionType()!.getFields())) {
  const d = f.astNode?.directives?.find((x) => x.name.value === "aws_subscribe");
  const arg = d?.arguments?.find((a) => a.name.value === "mutations");
  if (arg) PUBLISHERS.set(f.name, valueFromASTUntyped(arg.value) as string[]);
}

/** Mirrors the subscription filters in infra/lib/stacks.ts. */
function delivered(field: string, payload: any, m: Member) {
  if (field === "onTagChange" || field === "onProfileChange") return true;
  const vis = ["shared", `private:${m.userId}`].includes(payload?.visibility);
  if (field === "onItemChange") return vis || (payload?.removedFor ?? []).includes(m.userId);
  return vis;
}

export interface Subscriber {
  member: Member;
  field: string;
  doc: DocumentNode;
  send: (data: unknown) => void;
}
const subscribers = new Set<Subscriber>();

export function subscribe(s: Subscriber) {
  subscribers.add(s);
  return () => subscribers.delete(s);
}

/** Per-call log, so a check can assert what the app sent. */
export const calls: { member: string; field: string; args: unknown }[] = [];

export function memberForToken(token: string | undefined): Member | undefined {
  const name = token?.startsWith("fake-id.") ? token.slice("fake-id.".length) : undefined;
  return name ? MEMBERS[name] : undefined;
}

export async function graphql(token: string | undefined, query: string, variables: Record<string, unknown> = {}) {
  const member = memberForToken(token);
  if (!member) return { errors: [{ message: "Unauthorized", errorType: "UnauthorizedException" }] };
  const doc = parse(query);
  const published: { field: string; value: unknown }[] = [];
  const fieldResolver: GraphQLFieldResolver<unknown, unknown> = async (src, args, ctx, info) => {
    const parent = info.parentType.name;
    if (parent !== "Query" && parent !== "Mutation") return defaultFieldResolver(src, args, ctx, info);
    calls.push({ member: member.username, field: info.fieldName, args });
    const event = appSyncEvent(member, info.fieldName, args as Record<string, unknown>);
    const value = await handler(event);
    if (parent === "Mutation") published.push({ field: info.fieldName, value });
    return value;
  };
  const result = await execute({ schema, document: doc, variableValues: variables, fieldResolver });
  for (const p of published) await publish(p.field, p.value);
  return JSON.parse(JSON.stringify(result));
}

async function publish(mutation: string, value: unknown) {
  for (const s of subscribers) {
    if (!PUBLISHERS.get(s.field)?.includes(mutation)) continue;
    if (!delivered(s.field, value, s.member)) continue;
    const r = await execute({ schema, document: s.doc, rootValue: { [s.field]: value } });
    if (r.data) s.send(JSON.parse(JSON.stringify(r.data)));
  }
}

export function subscriptionField(doc: DocumentNode) {
  const op = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  const sel = op && "selectionSet" in op ? op.selectionSet.selections[0] : undefined;
  return sel && sel.kind === Kind.FIELD ? sel.name.value : undefined;
}

// ---- Cognito (only the calls web/src/auth.ts makes) -----------------------

export const PASSWORD = "e2e-password";
const passkeys = new Map<string, any[]>(Object.keys(MEMBERS).map((u) => [u, []]));

export function setPasskeys(username: string, list: any[]) {
  passkeys.set(username, list);
}

const tokensFor = (username: string) => ({
  AuthenticationResult: {
    IdToken: `fake-id.${username}`, AccessToken: `fake-access.${username}`,
    RefreshToken: `fake-refresh.${username}`, ExpiresIn: 3600, TokenType: "Bearer",
  },
});

const userFromAccess = (t: unknown) => (typeof t === "string" ? t.replace(/^fake-access\./, "") : "");

export function cognito(target: string, body: any): { status: number; json: unknown } {
  const fail = (type: string, message: string) => ({ status: 400, json: { __type: type, message } });
  switch (target) {
    case "InitiateAuth": {
      if (body.AuthFlow === "REFRESH_TOKEN_AUTH") {
        const u = String(body.AuthParameters?.REFRESH_TOKEN ?? "").replace(/^fake-refresh\./, "");
        return MEMBERS[u] ? { status: 200, json: { AuthenticationResult: { ...tokensFor(u).AuthenticationResult, RefreshToken: undefined } } } : fail("NotAuthorizedException", "Invalid Refresh Token");
      }
      const u = body.AuthParameters?.USERNAME;
      if (!MEMBERS[u]) return fail("UserNotFoundException", "User does not exist.");
      if (body.AuthParameters?.PREFERRED_CHALLENGE === "PASSWORD") {
        return body.AuthParameters.PASSWORD === PASSWORD ? { status: 200, json: tokensFor(u) } : fail("NotAuthorizedException", "Incorrect username or password.");
      }
      return { status: 200, json: { ChallengeName: "SELECT_CHALLENGE", Session: "s", AvailableChallenges: ["PASSWORD"] } };
    }
    case "RespondToAuthChallenge": {
      const u = body.ChallengeResponses?.USERNAME;
      return MEMBERS[u] && body.ChallengeResponses?.PASSWORD === PASSWORD ? { status: 200, json: tokensFor(u) } : fail("NotAuthorizedException", "Incorrect username or password.");
    }
    case "ListWebAuthnCredentials":
      return { status: 200, json: { Credentials: passkeys.get(userFromAccess(body.AccessToken)) ?? [] } };
    case "DeleteWebAuthnCredential": {
      const u = userFromAccess(body.AccessToken);
      passkeys.set(u, (passkeys.get(u) ?? []).filter((c) => c.CredentialId !== body.CredentialId));
      return { status: 200, json: {} };
    }
    case "RevokeToken":
      return { status: 200, json: {} };
    default:
      return fail("NotImplemented", `fake Cognito has no ${target}`);
  }
}

// ---- seed data -------------------------------------------------------------

async function as(username: string, field: string, args: Record<string, unknown>) {
  return handler(appSyncEvent(MEMBERS[username], field, args));
}

/** Both Members set up, a few Tags, and a mix of Chores and Tasks around `now`. */
export async function seed(now = Date.now()) {
  const DAY = 86_400_000;
  for (const [u, displayName, color] of [["asher", "Asher", "#3b82f6"], ["aubyn", "Aubyn", "#ec4899"]]) {
    await as(u, "putProfile", { input: { displayName, color, theme: "light", setupComplete: true, alertPrefs: JSON.stringify({ handoffAt: "20:00" }) } });
  }
  const tags = [["loc-kitchen", "Kitchen", "Locale"], ["loc-bath", "Bathroom", "Locale"], ["cat-clean", "Cleaning", "Category"]];
  for (const [id, name, group] of tags) await as("asher", "putTag", { input: { id, name, group } });
  const chore = (id: string, title: string, recurrence: object, tags: string[] = []) =>
    ({ id, kind: "chore", title, tags, visibility: "shared", archived: false, recurrence: JSON.stringify(recurrence) });
  const items = [
    chore("dishes", "Dishes", { type: "interval", every: 1, unit: "days" }, ["loc-kitchen", "cat-clean"]),
    chore("bath", "Clean bathroom", { type: "interval", every: 7, unit: "days" }, ["loc-bath", "cat-clean"]),
    chore("trash", "Take out trash", { type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" }),
    chore("plants", "Water plants", { type: "interval", every: 3, unit: "days" }),
    { id: "groceries", kind: "task", title: "Buy groceries", tags: [], visibility: "shared", archived: false, dueAt: now + DAY },
    { id: "gift", kind: "task", title: "Birthday gift", tags: [], visibility: `private:${MEMBERS.asher.userId}`, archived: false },
  ];
  for (const input of items) await as("asher", "putItem", { input });
  // Some history so Status varies: dishes done yesterday (due), bath done 8 days ago (overdue).
  await as("aubyn", "completeItem", { itemId: "dishes", at: now - DAY - 3600_000 });
  await as("asher", "completeItem", { itemId: "bath", at: now - 8 * DAY });
  await as("asher", "completeItem", { itemId: "plants", at: now - 3600_000 });
}
