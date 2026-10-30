// Passkeys in Settings (m6/05): what to list, and which may be removed.

/** Cognito's ListWebAuthnCredentials entry (CreatedAt in epoch seconds). */
export interface CognitoPasskey {
  CredentialId: string;
  FriendlyCredentialName?: string;
  RelyingPartyId?: string;
  CreatedAt: number;
}

export interface PasskeyRow {
  id: string;
  name: string;
  /** Epoch ms. */
  createdAt: number;
  /** Made for another domain (e.g. before the move): it can't sign in here. */
  oldDomain: boolean;
  /** False for the last passkey, or the last one that works on this domain. */
  removable: boolean;
}

export function passkeyRows(list: CognitoPasskey[], domain: string): PasskeyRow[] {
  const here = list.filter((c) => c.RelyingPartyId === domain).length;
  return list
    .map((c) => {
      const oldDomain = c.RelyingPartyId !== undefined && c.RelyingPartyId !== domain;
      return {
        id: c.CredentialId,
        name: c.FriendlyCredentialName || "Passkey",
        createdAt: c.CreatedAt * 1000,
        oldDomain,
        removable: list.length > 1 && (oldDomain || here > 1),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
