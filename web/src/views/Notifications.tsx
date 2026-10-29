import { useEffect, useState } from "react";
import {
  currentNotificationState, disableNotifications, enableNotifications, onWorkerChange, resaveSubscription,
} from "../notifications";
import type { NotificationState } from "../push";

const TEXT: Record<NotificationState, string> = {
  unsupported: "Add Honey Do to your Home Screen (Share, then Add to Home Screen) and open it from there to turn on notifications.",
  blocked: "Notifications are blocked for Honey Do. Turn them on in iOS Settings, Notifications, Honey Do.",
  off: "Off on this device. Turn on to get overdue Dings and your daily Handoff.",
  unsaved: "On, but not saved yet. It saves when you're back online.",
  on: "On for this device.",
};

/** The "Enable notifications" step, shared by Setup and Settings. Shows this device's on/off state. */
export function NotificationsStep() {
  const [state, setState] = useState<NotificationState>();
  const [reg, setReg] = useState<ServiceWorkerRegistration>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function refresh() {
    const s = await currentNotificationState();
    setReg(s.reg);
    setState(s.state);
    return s;
  }

  useEffect(() => {
    // Fetch the registration now so the button's click handler can prompt with no await first (iOS).
    // A subscription the server doesn't have yet (enabled offline, or rotated) is saved again here.
    void (async () => {
      const s = await refresh();
      if (s.state === "unsaved" && s.reg) {
        await resaveSubscription(s.reg);
        await refresh();
      }
    })().catch(() => {});
    // First launch: the worker may activate after the first check said "unsupported".
    return onWorkerChange(() => void refresh().catch(() => {}));
  }, []);

  function run(action: (r: ServiceWorkerRegistration) => Promise<unknown>) {
    if (!reg) return;
    setBusy(true);
    setError(undefined);
    // No await before action(): enableNotifications must reach requestPermission inside the tap.
    action(reg)
      .catch((e) => setError((e as Error).message))
      .finally(() => void refresh().finally(() => setBusy(false)));
  }

  if (!state) return null;
  const on = state === "on" || state === "unsaved";
  return (
    <div className="card">
      <strong>Notifications {on ? "on" : "off"}</strong>
      <p>{TEXT[state]}</p>
      {state === "off" && <button className="primary" disabled={busy} onClick={() => run(enableNotifications)}>Enable notifications</button>}
      {on && <button disabled={busy} onClick={() => run(disableNotifications)}>Turn off on this device</button>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
