-- auto_scope: when a comment matches a rule's keyword on a post outside its scope, and the
-- post's caption asks for that keyword ("comment KIMI and I'll send it"), the post joins the
-- rule's scope. A rule made before its reel goes live then works without being switched on.
ALTER TABLE rules ADD COLUMN auto_scope INTEGER NOT NULL DEFAULT 1;

-- Captions read from Zernio's live post list, cached so a busy post isn't re-read per comment.
CREATE TABLE post_captions (
  media_id TEXT PRIMARY KEY,
  caption TEXT,
  fetched_at INTEGER NOT NULL
);
