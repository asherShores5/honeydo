/**
 * A Private item can only be assigned to its owner (the API rejects anything else), so turning
 * Private on drops a partner Assignee. Self and "Either" (empty) are kept.
 */
export function assigneeWhenPrivate(assignee: string, ownerId: string): string {
  return assignee === ownerId ? assignee : "";
}
