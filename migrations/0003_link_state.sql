-- Instagram refuses buttons in a private reply to non-followers (since Aug 2026), so the
-- link goes out in a follow-up DM once the commenter replies. link_state tracks that step:
-- none (rule has no link) | awaiting_reply | delivered.
ALTER TABLE triggers ADD COLUMN link_state TEXT NOT NULL DEFAULT 'none';
CREATE INDEX triggers_awaiting ON triggers (contact_igsid, link_state);
