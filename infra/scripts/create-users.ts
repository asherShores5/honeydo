// Creates the two Cognito users with a strong one-time password each (used once, then passkeys).
// Passwords go to .secrets/initial-passwords.txt (chmod 600, gitignored), never stdout.
// Usage: npx tsx scripts/create-users.ts <userPoolId> [--reset]
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import * as path from "node:path";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { USERNAMES } from "../lib/stacks";

const [poolId, flag] = process.argv.slice(2);
if (!poolId) throw new Error("usage: create-users.ts <userPoolId> [--reset]");
const region = poolId.split("_")[0];
const cog = new CognitoIdentityProviderClient({ region });

function password() {
  // Unambiguous alphabet; 24 chars with guaranteed upper/lower/digit.
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]);
  while (chars.length < 24) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("").replace(/(.{6})(?=.)/g, "$1-");
}

async function exists(username: string) {
  try {
    await cog.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: username }));
    return true;
  } catch (e) {
    if ((e as Error).name === "UserNotFoundException") return false;
    throw e;
  }
}

async function main() {
  const lines: string[] = [];
  for (const username of USERNAMES) {
    const had = await exists(username);
    if (had && flag !== "--reset") {
      console.log(`${username}: exists, skipped (pass --reset to issue a new password)`);
      continue;
    }
    if (!had) await cog.send(new AdminCreateUserCommand({ UserPoolId: poolId, Username: username, MessageAction: "SUPPRESS" }));
    const pw = password();
    await cog.send(new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: username, Password: pw, Permanent: true }));
    lines.push(`${username}\t${pw}`);
    console.log(`${username}: ${had ? "password reset" : "created"}`);
  }

  if (lines.length) {
    const dir = path.join(__dirname, "..", "..", ".secrets");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, "initial-passwords.txt");
    writeFileSync(file, `# Aubi Honey one-time sign-in passwords (${new Date().toISOString()})\n${lines.join("\n")}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`passwords written to ${file}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
