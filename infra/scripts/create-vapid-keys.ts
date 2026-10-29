// One-off: creates the Web Push VAPID key pair in SSM Parameter Store (CDK can't create a SecureString).
// The private key goes to a SecureString (AWS-managed aws/ssm key), the public key to a String.
// The private key is never printed or written to disk. Refuses to run if either parameter exists:
// a new pair invalidates every push subscription, so rotating means deleting both parameters by
// hand first and having both phones turn notifications on again.
// Usage (from infra/, with AWS credentials for the app account): npx tsx scripts/create-vapid-keys.ts
import { generateKeyPairSync } from "node:crypto";
import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { VAPID_PARAMS } from "../lib/stacks";

const REGION = "us-west-1"; // AppStack's region (infra/bin)
const ssm = new SSMClient({ region: REGION });

/**
 * A P-256 key pair in the encoding Web Push uses (same as web-push's generateVAPIDKeys): the
 * public key is the 65-byte uncompressed point, the private key the 32-byte scalar, both base64url.
 */
function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, "base64url"), Buffer.from(pub.y!, "base64url")]);
  if (point.length !== 65 || Buffer.from(priv.d!, "base64url").length !== 32) throw new Error("unexpected key size");
  return { publicKey: point.toString("base64url"), privateKey: priv.d! };
}

async function exists(name: string) {
  try {
    await ssm.send(new GetParameterCommand({ Name: name })); // no decryption: we only need to know it's there
    return true;
  } catch (e) {
    if ((e as Error).name === "ParameterNotFound") return false;
    throw e;
  }
}

async function main() {
  const found = [];
  for (const name of [VAPID_PARAMS.private, VAPID_PARAMS.public]) if (await exists(name)) found.push(name);
  if (found.length) {
    console.error(`Refusing to overwrite: ${found.join(", ")} already exist in ${REGION}. Nothing was changed.`);
    process.exit(1);
  }

  const { publicKey, privateKey } = vapidKeys();
  // Overwrite: false is a second guard in case a parameter appeared since the check.
  await ssm.send(new PutParameterCommand({
    Name: VAPID_PARAMS.private, Type: "SecureString", Value: privateKey, Overwrite: false,
    Description: "Honey Do Web Push VAPID private key (read by the Notifier only)",
  }));
  await ssm.send(new PutParameterCommand({
    Name: VAPID_PARAMS.public, Type: "String", Value: publicKey, Overwrite: false,
    Description: "Honey Do Web Push VAPID public key (served to the app in config.json)",
  }));
  console.log(`created ${VAPID_PARAMS.private} (SecureString) and ${VAPID_PARAMS.public} (String) in ${REGION}`);
  console.log(`public key: ${publicKey}`);
}

main().catch((e) => {
  // Print the error name and message only, never the request (it would carry the key).
  console.error(`failed: ${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
});
