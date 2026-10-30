// Who @name means in quick-add (m6/01): each Member by first name of their display name or username.
import type { QuickAddContext } from "@aubi/shared";

export function quickAddMembers(profiles: { userId: string; displayName?: string; username: string }[]): QuickAddContext["members"] {
  return profiles.map((p) => ({
    userId: p.userId,
    names: [...new Set([p.displayName, p.username].filter((n): n is string => !!n?.trim()).map((n) => n.trim().split(/\s+/)[0]))],
  }));
}
