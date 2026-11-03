// The demo household: two made-up people. The visitor starts as Sam and can switch to Alex.
export interface DemoMember {
  userId: string;
  username: string;
  displayName: string;
  color: string;
}

export const DEMO_MEMBERS: Record<string, DemoMember> = {
  sam: { userId: "demo-sam", username: "sam", displayName: "Sam", color: "#3b82f6" },
  alex: { userId: "demo-alex", username: "alex", displayName: "Alex", color: "#ec4899" },
};

/** Fake tokens: the demo's GraphQL and realtime shims map the ID token back to a demo Member. */
export const tokenFor = (username: string) => `demo-id.${username}`;
export const demoTokens = (username: string) => ({
  idToken: tokenFor(username), accessToken: `demo-access.${username}`, refreshToken: `demo-refresh.${username}`,
});
/** The demo Member a refresh token belongs to, if any. */
export const memberForRefresh = (token: unknown) => {
  const u = String(token ?? "").replace(/^demo-refresh\./, "");
  return Object.hasOwn(DEMO_MEMBERS, u) ? DEMO_MEMBERS[u] : undefined;
};

export function memberForToken(token: string | undefined): DemoMember | undefined {
  const name = token?.startsWith("demo-id.") ? token.slice("demo-id.".length) : undefined;
  return name && Object.hasOwn(DEMO_MEMBERS, name) ? DEMO_MEMBERS[name] : undefined;
}

export const partnerOf = (username: string) => Object.keys(DEMO_MEMBERS).find((u) => u !== username)!;
