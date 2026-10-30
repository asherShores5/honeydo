import { describe, expect, it } from "vitest";
import { passkeyRows } from "./passkeys";

const cred = (id: string, rp: string, createdSec: number, name?: string) => ({
  CredentialId: id, RelyingPartyId: rp, CreatedAt: createdSec, ...(name ? { FriendlyCredentialName: name } : {}),
});

describe("passkeys in Settings (m6/05)", () => {
  it("lists each with a name, created date and whether it's for an old domain, newest first", () => {
    const rows = passkeyRows([
      cred("old", "aubi.ashershores.com", 1_790_000_000, "iPhone"),
      cred("new", "honeydo.ashershores.com", 1_792_000_000),
    ], "honeydo.ashershores.com");
    expect(rows).toEqual([
      { id: "new", name: "Passkey", createdAt: 1_792_000_000_000, oldDomain: false, removable: false }, // the only one for this domain
      { id: "old", name: "iPhone", createdAt: 1_790_000_000_000, oldDomain: true, removable: true },
    ]);
  });

  it("won't remove the last passkey for this domain", () => {
    const rows = passkeyRows([
      cred("old", "aubi.ashershores.com", 1_790_000_000),
      cred("only", "honeydo.ashershores.com", 1_792_000_000),
    ], "honeydo.ashershores.com");
    expect(rows.map((r) => [r.id, r.removable])).toEqual([["only", false], ["old", true]]);
  });

  it("won't remove the only passkey at all", () => {
    expect(passkeyRows([cred("one", "honeydo.ashershores.com", 1)], "honeydo.ashershores.com")[0].removable).toBe(false);
  });
});
