// Comments (M2) in the client: folding live and own addComment results into the store.

export interface Comment { id: string; itemId: string; at: number; by: string; text: string }
/** The onCommentChange / addComment envelope. Delivery is already filtered by Visibility. */
export interface CommentChange { comment: Comment }
interface FeedEvent { id: string; at: number; by: string; type: string; itemId?: string; title?: string; detail?: string }

/** The slice of the store this module touches. `comments` holds lists for Items opened this session. */
export interface CommentsState { comments: Record<string, Comment[]>; feed: FeedEvent[] }

/** Same ID as the server's Activity entry for the Comment, so a snapshot refresh replaces it cleanly. */
const feedId = (commentId: string) => `comment-${commentId}`;

/** Fold one Comment into the item's list and Activity. Returns `s` unchanged if it's already there. */
export function applyCommentChange<S extends CommentsState>(s: S, change: CommentChange, itemTitle?: string): S {
  const { comment } = change;
  const list = s.comments[comment.itemId] ?? [];
  const inList = list.some((x) => x.id === comment.id);
  const inFeed = s.feed.some((f) => f.id === feedId(comment.id));
  if (inList && inFeed) return s;
  return {
    ...s,
    comments: inList ? s.comments : { ...s.comments, [comment.itemId]: [...list, comment].sort((a, b) => a.at - b.at) },
    feed: inFeed
      ? s.feed
      : [
          { id: feedId(comment.id), at: comment.at, by: comment.by, type: "commented", itemId: comment.itemId, title: itemTitle, detail: comment.text },
          ...s.feed,
        ],
  };
}

/** The item went Private to someone else: forget its Comments and its Activity entries too. */
export function dropItemActivity<S extends CommentsState>(s: S, itemId: string): S {
  const { [itemId]: _gone, ...comments } = s.comments;
  return { ...s, comments, feed: s.feed.filter((f) => f.itemId !== itemId) };
}
