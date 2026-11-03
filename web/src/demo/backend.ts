// The guest demo's backend, entirely in the browser: the real API handler (api/src/handler.ts)
// on the in-memory table, behind a GraphQL executor built from schema/schema.graphql, plus the
// few Cognito calls web/src/auth.ts makes. Same idea as e2e/backend.ts, minus Node.
// Loaded lazily (shims.ts imports it on the first call), so the real app never downloads it.
import {
  GraphQLScalarType, Kind, buildSchema, defaultFieldResolver, execute, parse, valueFromASTUntyped,
  type DocumentNode, type GraphQLFieldResolver, type ValueNode,
} from "graphql";
import sdl from "../../../schema/schema.graphql?raw";
import { handler, setDocClient } from "../../../api/src/handler";
import { FakeDocClient } from "../../../api/src/testing/fakeDynamo";
import { appSyncEvent } from "../../../api/src/testing/event";
import { DEMO_MEMBERS, memberForToken, type DemoMember } from "./members";
import { DB_KEY } from "./mode";

export { tokenFor } from "./members";

export { DB_KEY } from "./mode";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// AppSync supplies AWSJSON; graphql-js needs it declared.
const AWSJSON = new GraphQLScalarType({
  name: "AWSJSON",
  serialize: (v) => (typeof v === "string" ? v : JSON.stringify(v)),
  parseValue: (v) => v,
  parseLiteral: (ast: ValueNode) => (ast.kind === Kind.STRING ? ast.value : valueFromASTUntyped(ast)),
});
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
function delivered(field: string, payload: any, m: DemoMember) {
  if (field === "onTagChange" || field === "onProfileChange") return true;
  const vis = ["shared", `private:${m.userId}`].includes(payload?.visibility);
  if (field === "onItemChange") return vis || (payload?.removedFor ?? []).includes(m.userId);
  return vis;
}

function subscriptionField(doc: DocumentNode) {
  const op = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  const sel = op && "selectionSet" in op ? op.selectionSet.selections[0] : undefined;
  return sel && sel.kind === Kind.FIELD ? sel.name.value : undefined;
}

interface Subscriber {
  member: DemoMember;
  field: string;
  doc: DocumentNode;
  send: (data: unknown) => void;
}

export interface DemoBackend {
  /** One GraphQL request, as AppSync would answer it for the Member holding `token`. */
  graphql(token: string | undefined, query: string, variables?: Record<string, unknown>): Promise<{ data?: any; errors?: { message: string }[] }>;
  /** A realtime subscription; `send` gets each delivered payload. Undefined if the token or query is no good. */
  subscribe(token: string | undefined, query: string, send: (data: unknown) => void): (() => void) | undefined;
  /** The Cognito calls auth.ts makes after sign-in (refresh, passkey list, revoke). */
  cognito(target: string, body: any): { status: number; json: unknown };
}

export async function createDemoBackend(opts: { store: Store; now?: number }): Promise<DemoBackend> {
  const { store } = opts;
  const db = new FakeDocClient();
  setDocClient(db);
  const subscribers = new Set<Subscriber>();
  const save = () => store.setItem(DB_KEY, JSON.stringify(db.dump()));

  const saved = store.getItem(DB_KEY);
  if (saved) db.seed(...(JSON.parse(saved) as Record<string, unknown>[]));
  else {
    await seed(opts.now ?? Date.now());
    save();
  }

  async function publish(mutation: string, value: unknown) {
    for (const s of subscribers) {
      if (!PUBLISHERS.get(s.field)?.includes(mutation) || !delivered(s.field, value, s.member)) continue;
      const r = await execute({ schema, document: s.doc, rootValue: { [s.field]: value } });
      if (r.data) s.send(JSON.parse(JSON.stringify(r.data)));
    }
  }

  return {
    async graphql(token, query, variables = {}) {
      const member = memberForToken(token);
      if (!member) return { errors: [{ message: "Unauthorized" }] };
      const published: { field: string; value: unknown }[] = [];
      const fieldResolver: GraphQLFieldResolver<unknown, unknown> = async (src, args, ctx, info) => {
        const parent = info.parentType.name;
        if (parent !== "Query" && parent !== "Mutation") return defaultFieldResolver(src, args, ctx, info);
        const value = await handler(appSyncEvent(member, info.fieldName, args as Record<string, unknown>));
        if (parent === "Mutation") published.push({ field: info.fieldName, value });
        return value;
      };
      const result = await execute({ schema, document: parse(query), variableValues: variables, fieldResolver });
      if (published.length) save();
      for (const p of published) await publish(p.field, p.value);
      return JSON.parse(JSON.stringify(result));
    },

    subscribe(token, query, send) {
      const member = memberForToken(token);
      const doc = parse(query);
      const field = subscriptionField(doc);
      if (!member || !field) return undefined;
      const s = { member, field, doc, send };
      subscribers.add(s);
      return () => void subscribers.delete(s);
    },

    cognito(target, body) {
      const tokens = (username: string) => ({
        AuthenticationResult: { IdToken: `demo-id.${username}`, AccessToken: `demo-access.${username}`, ExpiresIn: 24 * 3600, TokenType: "Bearer" },
      });
      if (target === "InitiateAuth" && body?.AuthFlow === "REFRESH_TOKEN_AUTH") {
        const u = String(body.AuthParameters?.REFRESH_TOKEN ?? "").replace(/^demo-refresh\./, "");
        if (DEMO_MEMBERS[u]) return { status: 200, json: tokens(u) };
      }
      if (target === "ListWebAuthnCredentials") return { status: 200, json: { Credentials: [] } };
      if (target === "RevokeToken") return { status: 200, json: {} };
      return { status: 400, json: { __type: "DemoOnly", message: "Not available in the demo" } };
    },
  };
}

// ---- seed: a lived-in household around `now` --------------------------------

const DAY = 86_400_000;
const HOUR = 3_600_000;

async function as(username: string, field: string, args: Record<string, unknown>) {
  return handler(appSyncEvent(DEMO_MEMBERS[username], field, args));
}

async function seed(now: number) {
  for (const m of Object.values(DEMO_MEMBERS)) {
    await as(m.username, "putProfile", {
      input: { displayName: m.displayName, color: m.color, theme: "system", setupComplete: true, alertPrefs: JSON.stringify({ handoffAt: "20:00" }) },
    });
  }
  const tags = [
    ["loc-kitchen", "Kitchen", "Locale"], ["loc-bath", "Bathroom", "Locale"], ["loc-yard", "Yard", "Locale"],
    ["cat-clean", "Cleaning", "Category"], ["cat-errands", "Errands", "Category"], ["cat-pets", "Pets", "Category"],
  ];
  for (const [id, name, group] of tags) await as("sam", "putTag", { input: { id, name, group } });

  const sam = DEMO_MEMBERS.sam.userId;
  const alex = DEMO_MEMBERS.alex.userId;
  const every = (n: number) => JSON.stringify({ type: "interval", every: n, unit: "days" });
  const chore = (id: string, title: string, recurrence: string, tags: string[], extra: object = {}) =>
    ({ id, kind: "chore", title, tags, recurrence, visibility: "shared", archived: false, ...extra });
  const task = (id: string, title: string, tags: string[], extra: object = {}) =>
    ({ id, kind: "task", title, tags, visibility: "shared", archived: false, ...extra });

  const items = [
    chore("dishes", "Dishes", every(1), ["loc-kitchen", "cat-clean"]),
    chore("bathroom", "Clean bathroom", every(7), ["loc-bath", "cat-clean"], { assigneeId: sam, severity: "medium" }),
    chore("trash", "Take out trash", JSON.stringify({ type: "calendar", freq: "weekly", byWeekday: [2], at: "20:00" }), [], { assigneeId: alex, severity: "high" }),
    chore("plants", "Water plants", every(3), []),
    chore("vacuum", "Vacuum", every(7), ["cat-clean"], { assigneeId: alex }),
    chore("litter", "Scoop litter box", every(2), ["cat-pets"], { severity: "medium" }),
    chore("lawn", "Mow the lawn", every(14), ["loc-yard"], { assigneeId: sam }),
    chore("sheets", "Change the sheets", every(14), ["cat-clean"], { severity: "low" }),
    task("groceries", "Buy groceries", ["cat-errands"], { assigneeId: sam, dueAt: now + DAY, severity: "medium", notes: "Oat milk, eggs, coffee" }),
    task("faucet", "Fix the leaky kitchen faucet", ["loc-kitchen"], { dueAt: now + 3 * DAY }),
    task("vet", "Book the cat's vet checkup", ["cat-pets"], { assigneeId: alex }),
    task("library", "Return library books", ["cat-errands"]),
    // Private: Alex never sees this one.
    task("gift", "Birthday present for Alex", [], { visibility: `private:${sam}`, dueAt: now + 10 * DAY }),
  ];
  for (const input of items) await as("sam", "putItem", { input });

  const done: [string, string, number][] = [
    ["alex", "dishes", now - DAY - HOUR], // due again
    ["sam", "bathroom", now - 9 * DAY], // overdue
    ["sam", "plants", now - HOUR],
    ["alex", "vacuum", now - 3 * DAY],
    ["alex", "litter", now - 2 * DAY - 3 * HOUR], // overdue
    ["sam", "lawn", now - 5 * DAY],
    ["alex", "sheets", now - 15 * DAY], // overdue
    ["alex", "library", now - 20 * HOUR], // a finished Task
  ];
  for (const [u, itemId, at] of done) await as(u, "completeItem", { itemId, at });

  await as("alex", "postNote", { id: "note-milk", text: "We're out of oat milk", pinned: true });
  await as("sam", "postNote", { id: "note-plumber", text: "Plumber can come Thursday 9–11 if the faucet fix doesn't work" });
  await as("alex", "addComment", { itemId: "faucet", id: "c-washer", text: "I think it needs a new washer. Hardware store has them." });
}
