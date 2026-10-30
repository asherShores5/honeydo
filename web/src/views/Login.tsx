import { useState } from "react";
import { signInWithPasskey, signInWithPassword } from "../auth";
import { getConfig } from "../config";

export function Login() {
  const { usernames } = getConfig();
  const [username, setUsername] = useState(localStorage.getItem("aubi.lastUser") ?? usernames[0]);
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      const msg = (e as Error).message;
      setError(/NotAllowed|abort/i.test(msg) ? "Passkey cancelled." : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <img src="/icon.svg" alt="" width={88} height={88} />
      <h1>HoneyDo</h1>
      <div className="seg">
        {usernames.map((u) => (
          <button key={u} className={u === username ? "on" : ""} onClick={() => setUsername(u)}>
            {u[0].toUpperCase() + u.slice(1)}
          </button>
        ))}
      </div>
      {!usePassword ? (
        <>
          <button className="primary big" disabled={busy} onClick={() => run(() => signInWithPasskey(username))}>
            Sign in with Face ID
          </button>
          <button className="link" onClick={() => setUsePassword(true)}>First time? Use your password</button>
        </>
      ) : (
        <form onSubmit={(e) => (e.preventDefault(), run(() => signInWithPassword(username, password)))}>
          <input type="password" autoComplete="current-password" placeholder="Password" value={password}
            onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button className="primary big" disabled={busy || !password}>Sign in</button>
          <button type="button" className="link" onClick={() => setUsePassword(false)}>Use Face ID instead</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
