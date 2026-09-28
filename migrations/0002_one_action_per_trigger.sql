-- At most one opening DM and one public reply per trigger. This lets a webhook
-- retry after a partial failure re-enqueue whatever is missing without ever
-- queueing a second copy. DMs are left unconstrained (milestone 2 sends several).
CREATE UNIQUE INDEX actions_one_per_trigger ON actions (trigger_id, type)
  WHERE trigger_id IS NOT NULL AND type IN ('private_reply', 'public_reply');
