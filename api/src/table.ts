// Table layout and DynamoDB helpers shared by the API (handler.ts) and the Notifier (notifier.ts).

/** The one household partition. Still hard-coded (out of scope per spec). */
export const PK = "HH#aubi";

/** One device's Web Push subscription. Keyed by the owner's sub, so nobody can write another Member's. */
export const pushKey = (userId: string, deviceId: string) => `PUSH#${userId}#${deviceId}`;
/** The last Ding one Member got about one Item. */
export const nstateKey = (itemId: string, userId: string) => `NSTATE#${itemId}#${userId}`;
/** When one Member's last Handoff was sent. */
export const handoffKey = (userId: string) => `HANDOFF#${userId}`;

/**
 * Use as `.then(ok, ifConditionFailed(x))`: a failed ConditionExpression gives `x`, and so does a
 * transaction cancelled only by failed conditions. Other errors rethrow.
 */
export function ifConditionFailed<T>(value: T) {
  return (e: unknown) => {
    const err = e as Error & { CancellationReasons?: { Code?: string }[] };
    if (err.name === "ConditionalCheckFailedException") return value;
    const codes = (err.CancellationReasons ?? []).map((r) => r.Code);
    if (
      err.name === "TransactionCanceledException" &&
      codes.includes("ConditionalCheckFailed") &&
      codes.every((c) => c === "None" || c === "ConditionalCheckFailed")
    ) {
      return value;
    }
    throw e;
  };
}
