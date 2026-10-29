// Browser side of the Enable notifications step; the pure rules are in push.ts.
import { Q, gql } from "./api";
import { getConfig } from "./config";
import { applicationServerKey, notificationState, subscriptionArgs, type NotificationState } from "./push";

const DEVICE_KEY = "aubi.deviceId";
const SAVED_KEY = "aubi.pushEndpoint";

/** A random ID for this install, kept in localStorage. Re-enabling reuses it so the server record is replaced. */
function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) localStorage.setItem(DEVICE_KEY, (id = crypto.randomUUID()));
  return id;
}

/**
 * Push needs the worker and, on iOS, the home-screen app (Safari tabs have no PushManager).
 * Never prompts: reading state is safe to do on load.
 */
export async function currentNotificationState(): Promise<{ state: NotificationState; reg?: ServiceWorkerRegistration }> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const reg = supported ? await navigator.serviceWorker.getRegistration() : undefined;
  const sub = await reg?.pushManager.getSubscription();
  const state = notificationState({
    supported: !!reg && !!getConfig().vapidPublicKey,
    permission: supported ? Notification.permission : "default",
    endpoint: sub?.endpoint,
    savedEndpoint: localStorage.getItem(SAVED_KEY) ?? undefined,
  });
  return { state, reg };
}

async function save(sub: PushSubscription) {
  await gql(Q.putPushSubscription, subscriptionArgs(sub.toJSON(), deviceId()));
  localStorage.setItem(SAVED_KEY, sub.endpoint);
}

/**
 * Call straight from the button's click handler with a registration fetched beforehand. iOS only
 * shows the prompt during a user gesture, so nothing (no network, no awaits) runs before
 * requestPermission, and subscribe follows it immediately. Saving to the server comes last.
 */
export function enableNotifications(reg: ServiceWorkerRegistration): Promise<void> {
  return Notification.requestPermission().then(async (permission) => {
    if (permission !== "granted") throw new Error("Notifications are blocked. Turn them on in iOS Settings, then try again.");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(getConfig().vapidPublicKey!),
    });
    await save(sub);
  });
}

/** Re-save a subscription the server doesn't have (enable finished offline, or the browser rotated it). */
export async function resaveSubscription(reg: ServiceWorkerRegistration) {
  const sub = await reg.pushManager.getSubscription();
  if (sub) await save(sub);
}

export async function disableNotifications(reg: ServiceWorkerRegistration) {
  await gql(Q.deletePushSubscription, { deviceId: deviceId() });
  localStorage.removeItem(SAVED_KEY);
  await (await reg.pushManager.getSubscription())?.unsubscribe();
}
