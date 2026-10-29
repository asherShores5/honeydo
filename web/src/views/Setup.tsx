import { useState } from "react";
import { registerPasskey } from "../auth";
import { readAlertPrefs } from "@aubi/shared";
import { saveProfile, useStore } from "../store";
import { NotificationsStep } from "./Notifications";

export const COLORS = ["#2f7d4f", "#c2410c", "#7c3aed", "#0e7490", "#be185d", "#a16207"];

/** First-run: name, color, theme, and the required Handoff time (SPEC §4.6). */
export function Setup() {
  const me = useStore((s) => s.me!);
  const [name, setName] = useState(me.displayName ?? me.username[0].toUpperCase() + me.username.slice(1));
  const [color, setColor] = useState(me.color ?? COLORS[me.username === "aubyn" ? 4 : 0]);
  const [theme, setTheme] = useState(me.theme ?? "system");
  const [handoffAt, setHandoffAt] = useState(me.alertPrefs ? readAlertPrefs(me.alertPrefs).handoffAt : "");
  const [passkey, setPasskey] = useState<"idle" | "done" | "skipped">(localStorage.getItem("aubi.hasPasskey") ? "done" : "idle");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function addPasskey() {
    setError(undefined);
    try {
      await registerPasskey();
      setPasskey("done");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function finish() {
    setBusy(true);
    setError(undefined);
    try {
      await saveProfile({
        displayName: name.trim(), color, theme,
        alertPrefs: { handoffAt, overdueAlerts: true },
        setupComplete: true,
      });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="page setup">
      <h1>Welcome 👋</h1>
      <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
      <label>Your color
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} aria-label={c} className={c === color ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </label>
      <label>Theme
        <div className="seg">
          {["system", "light", "dark"].map((t) => (
            <button key={t} className={t === theme ? "on" : ""} onClick={() => setTheme(t)}>{t}</button>
          ))}
        </div>
      </label>
      <label>Handoff time <span className="req">required</span>
        <input type="time" value={handoffAt} onChange={(e) => setHandoffAt(e.target.value)} />
        <small>Each day at this time you'll get a handoff: what got done, what's overdue, what's coming up.</small>
      </label>
      <div className="card">
        <strong>Face ID sign-in</strong>
        {passkey === "done" ? <p>✅ Passkey added. You won't need your password again.</p> : (
          <>
            <p>Add a passkey so you can sign in with Face ID instead of your password.</p>
            <button className="primary" onClick={addPasskey}>Add passkey</button>
            {passkey === "idle" && <button className="link" onClick={() => setPasskey("skipped")}>Later</button>}
          </>
        )}
      </div>
      <NotificationsStep />
      {error && <p className="error">{error}</p>}
      <button className="primary big" disabled={busy || !name.trim() || !handoffAt || passkey === "idle"} onClick={finish}>
        Get started
      </button>
    </div>
  );
}
