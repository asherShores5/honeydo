import type { UserId } from "./types";

/** May `userId` see an Item (or Activity entry) with this Visibility? Shared, or Private to them. */
export function canSee(visibility: string, userId: UserId): boolean {
  return visibility === "shared" || visibility === `private:${userId}`;
}
