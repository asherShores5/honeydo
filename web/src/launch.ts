// What a launch shows before the server answers (SPEC story 34). Pure; the glue is store.start().

/**
 * Show the cached snapshot at once (and sync behind it) only when it is the signed-in Member's
 * own. A cache from someone else, or no cache, waits for the server.
 */
export function showCachedFirst(cachedMe: { username: string } | undefined, username: string | undefined): boolean {
  return !!cachedMe && !!username && cachedMe.username === username;
}
