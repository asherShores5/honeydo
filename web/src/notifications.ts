// Browser side of the Enable notifications step and of sign-out's push cleanup; the pure rules
// are in push.ts and pushDevice.ts.
import { ApiError, Q, gql } from "./api";
import { currentUsername } from "./auth";
import { getConfig } from "./config";
import { applicationServerKey, notificationState, subscriptionArgs, type NotificationState } from "./push";
import { SAVED_KEY, deviceId as storedDeviceId, forgetDevice, queueDelete, takeDeletes } from "./pushDevice";
import { settleWithin } from "./timeout";

/** How long the Enable step waits for a first-launch worker before calling this device unsupported. */
const WORKER_READY_MS = 3000;

const deviceId = () => storedDeviceId(localStorage);

/**
 * Push needs the worker and, on iOS, the home-screen app (Safari tabs have no PushManager).
 * Never prompts: reading state is safe to do on load.
 */
export async function currentNotificationState(): Promise<{ state: NotificationState; reg?: ServiceWorkerRegistration }> {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // On first launch the worker is still installing, so getRegistration() may come back empty.
  // Wait (briefly) for it to be ready before calling this device unsupported; the step re-checks
  // when the worker takes over (onWorkerChange).
  const reg = supported
    ? (await navigator.serviceWorker.getRegistration()) ?? (await settleWithin(navigator.serviceWorker.ready, WORKER_READY_MS))
    : undefined;
  const sub = await reg?.pushManager.getSubscription();
  const state = notificationState({
    supported: !!reg && !!getConfig().vapidPublicKey,
    permission: supported ? Notification.permission : "default",
    endpoint: sub?.endpoint,
    savedEndpoint: localStorage.getItem(SAVED_KEY) ?? undefined,
  });
  return { state, reg };
}

/** Calls `fn` when a service worker becomes ready or takes over this page. Returns an unsubscribe. */
export function onWorkerChange(fn: () => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  let live = true;
  void navigator.serviceWorker.ready.then(() => live && fn());
  navigator.serviceWorker.addEventListener("controllerchange", fn);
  return () => {
    live = false;
    navigator.serviceWorker.removeEventListener("controllerchange", fn);
  };
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

/**
 * Sign-out on this phone (story 25): delete this device's subscription record, unsubscribe it in
 * the browser, and forget its device ID, so the next Member here never gets this Member's Dings
 * or Handoff. Best effort: an offline delete is queued for this Member's next sign-in, and the
 * unsubscribe alone already makes the push service answer 410, which the Notifier prunes.
 * Call before auth.signOut, while the tokens still work.
 */
export async function releaseThisDevice() {
  const username = currentUsername();
  const id = forgetDevice(localStorage);
  if (id && username) {
    await gql(Q.deletePushSubscription, { deviceId: id }).catch((e) => {
      if (e instanceof ApiError && e.kind === "network") queueDelete(localStorage, username, id);
    });
  }
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // nothing more to do: the record is gone or queued
  }
}

/** Send the sign-out deletes queued offline for the signed-in Member. Call after sign-in. */
export async function sendQueuedDeletes() {
  const username = currentUsername();
  if (!username) return;
  for (const id of takeDeletes(localStorage, username)) {
    await gql(Q.deletePushSubscription, { deviceId: id }).catch((e) => {
      if (e instanceof ApiError && e.kind === "network") queueDelete(localStorage, username, id);
    });
  }
}
