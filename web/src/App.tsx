import { useEffect, useState, useSyncExternalStore } from "react";
import { isSignedIn, onAuthChange } from "./auth";
import { loadConfig } from "./config";
import { sendQueuedDeletes } from "./notifications";
import { start, stop, useStore } from "./store";
import { Login } from "./views/Login";
import { Setup } from "./views/Setup";
import { Home } from "./views/Home";

export function App() {
  const [configError, setConfigError] = useState<string>();
  const [configured, setConfigured] = useState(false);
  const signedIn = useSyncExternalStore(onAuthChange, isSignedIn);
  const ready = useStore((s) => s.ready);
  const me = useStore((s) => s.me);
  const theme = me?.theme ?? "system";
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    loadConfig().then(() => setConfigured(true), (e) => setConfigError(String(e)));
  }, []);

  useEffect(() => {
    if (!configured || !signedIn) return;
    setStartError(undefined);
    start().catch((e) => setStartError(String(e.message ?? e)));
    void sendQueuedDeletes(); // sign-out cleanup that was offline last time (story 25)
    return stop;
  }, [configured, signedIn]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--me", me?.color ?? "#2f7d4f");
  }, [theme, me?.color]);

  if (configError) return <div className="center">Couldn't load app config: {configError}</div>;
  if (!configured) return <div className="center">Loading…</div>;
  if (!signedIn) return <Login />;
  if (startError) return <div className="center">Couldn't reach the server: {startError}</div>;
  if (!ready || !me) return <div className="center">Syncing…</div>;
  if (!me.setupComplete) return <Setup />;
  return <Home />;
}
