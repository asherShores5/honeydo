export interface Config {
  region: string;
  userPoolId: string;
  clientId: string;
  graphqlUrl: string;
  usernames: string[];
}

let config: Config | undefined;

/** Deployed alongside the app by CDK, so the build has no environment baked in. */
export async function loadConfig(): Promise<Config> {
  if (config) return config;
  const cached = localStorage.getItem("aubi.config");
  try {
    const r = await fetch("/config.json", { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    config = (await r.json()) as Config;
    localStorage.setItem("aubi.config", JSON.stringify(config));
  } catch (e) {
    if (!cached) throw e;
    config = JSON.parse(cached) as Config; // offline launch
  }
  return config;
}

export function getConfig(): Config {
  if (!config) throw new Error("config not loaded");
  return config;
}
