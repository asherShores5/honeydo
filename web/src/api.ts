import { freshTokens } from "./auth";
import { getConfig } from "./config";

export class ApiError extends Error {
  constructor(message: string, public kind: "network" | "conflict" | "rejected") {
    super(message);
  }
}

const ITEM = `id kind title notes tags assigneeId visibility severity recurrence dueAt warnWindow
  lastDoneAt lastDoneBy snoozedUntil archived createdBy createdAt updatedAt version`;
const TAG = `id name group color order deleted updatedAt`;
const PROFILE = `userId username displayName color theme density defaultView savedViews alertPrefs setupComplete updatedAt`;
// Subscriptions only receive fields the mutation selected, so all item mutations share this.
const CHANGE = `item { ${ITEM} } visibility removedFor redacted`;

export const Q = {
  me: `query { me { ${PROFILE} } }`,
  snapshot: `query { snapshot { items { ${ITEM} } tags { ${TAG} } profiles { ${PROFILE} }
    feed { id at by type itemId title detail } serverTime } }`,
  completions: `query($itemId: ID!, $limit: Int) { completions(itemId: $itemId, limit: $limit) { itemId at by note } }`,
  putItem: `mutation($input: ItemInput!, $expectedVersion: Int) { putItem(input: $input, expectedVersion: $expectedVersion) { ${CHANGE} } }`,
  completeItem: `mutation($itemId: ID!, $at: Float, $note: String) { completeItem(itemId: $itemId, at: $at, note: $note) { ${CHANGE} } }`,
  undoCompletion: `mutation($itemId: ID!, $at: Float!) { undoCompletion(itemId: $itemId, at: $at) { ${CHANGE} } }`,
  putTag: `mutation($input: TagInput!) { putTag(input: $input) { ${TAG} } }`,
  deleteTag: `mutation($id: ID!) { deleteTag(id: $id) { ${TAG} } }`,
  putProfile: `mutation($input: ProfileInput!) { putProfile(input: $input) { ${PROFILE} } }`,
  putPushSubscription: `mutation($deviceId: ID!, $endpoint: String!, $p256dh: String!, $auth: String!) {
    putPushSubscription(deviceId: $deviceId, endpoint: $endpoint, p256dh: $p256dh, auth: $auth) { deviceId enabled } }`,
  deletePushSubscription: `mutation($deviceId: ID!) { deletePushSubscription(deviceId: $deviceId) { deviceId enabled } }`,
  onItemChange: `subscription { onItemChange { ${CHANGE} } }`,
  onTagChange: `subscription { onTagChange { ${TAG} } }`,
  onProfileChange: `subscription { onProfileChange { ${PROFILE} } }`,
};

export async function gql<T = any>(query: string, variables: object = {}): Promise<T> {
  let r: Response;
  try {
    const { idToken } = await freshTokens();
    r = await fetch(getConfig().graphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: idToken },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ApiError(String((e as Error).message), "network");
  }
  if (r.status >= 500) throw new ApiError(`server ${r.status}`, "network");
  const json = await r.json();
  if (json.errors?.length) {
    const msg = json.errors.map((e: { message: string }) => e.message).join("; ");
    throw new ApiError(msg, msg.includes("ConflictError") ? "conflict" : "rejected");
  }
  return json.data as T;
}

// ---- AppSync realtime (graphql-ws dialect) --------------------------------

type Handler = (data: any) => void;

export class Realtime {
  private ws?: WebSocket;
  private subs = new Map<string, { query: string; handler: Handler }>();
  private kaTimer?: number;
  private retry = 0;
  private closed = false;

  constructor(private onReconnect: () => void, private onStatus: (live: boolean) => void) {}

  subscribe(query: string, handler: Handler) {
    const id = crypto.randomUUID();
    this.subs.set(id, { query, handler });
    if (this.ws?.readyState === WebSocket.OPEN) void this.start(id);
  }

  async connect() {
    this.closed = false;
    const { graphqlUrl } = getConfig();
    const host = new URL(graphqlUrl).host;
    const { idToken } = await freshTokens();
    const url = graphqlUrl.replace("https://", "wss://").replace("appsync-api", "appsync-realtime-api");
    const header = btoa(JSON.stringify({ host, Authorization: idToken }));
    const ws = new WebSocket(`${url}?header=${encodeURIComponent(header)}&payload=e30=`, ["graphql-ws"]);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "connection_ack") {
        const first = this.retry > 0;
        this.retry = 0;
        this.onStatus(true);
        this.armKeepAlive(msg.payload?.connectionTimeoutMs ?? 300_000);
        for (const id of this.subs.keys()) void this.start(id);
        if (first) this.onReconnect();
      } else if (msg.type === "ka") {
        this.armKeepAlive(300_000);
      } else if (msg.type === "data") {
        const sub = this.subs.get(msg.id);
        const data = msg.payload?.data;
        if (sub && data) sub.handler(Object.values(data)[0]);
      } else if (msg.type === "error" || msg.type === "connection_error") {
        console.warn("realtime error", msg);
      }
    };
    ws.onclose = () => {
      this.onStatus(false);
      window.clearTimeout(this.kaTimer);
      if (this.closed) return;
      const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
      window.setTimeout(() => void this.connect().catch(() => ws.onclose?.(new CloseEvent("close"))), delay);
    };
  }

  /** iOS drops sockets in the background; call on resume. */
  ensure() {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.retry = Math.max(this.retry, 1);
      void this.connect();
    }
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private armKeepAlive(ms: number) {
    window.clearTimeout(this.kaTimer);
    this.kaTimer = window.setTimeout(() => this.ws?.close(), ms);
  }

  private async start(id: string) {
    const { graphqlUrl } = getConfig();
    const { idToken } = await freshTokens();
    this.ws?.send(
      JSON.stringify({
        id,
        type: "start",
        payload: {
          data: JSON.stringify({ query: this.subs.get(id)!.query, variables: {} }),
          extensions: { authorization: { host: new URL(graphqlUrl).host, Authorization: idToken } },
        },
      }),
    );
  }
}
