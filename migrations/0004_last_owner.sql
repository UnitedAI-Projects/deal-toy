-- Enforce the invariant at write time, including concurrent requests that both passed
-- the application's earlier owner count. ABORT rolls back the whole D1 batch.
CREATE TRIGGER members_keep_active_owner
BEFORE UPDATE OF owner, status ON members
WHEN OLD.owner = 1 AND OLD.status = 'active'
  AND (NEW.owner <> 1 OR NEW.status <> 'active')
  AND NOT EXISTS (
    SELECT 1 FROM members
    WHERE owner = 1 AND status = 'active' AND email <> OLD.email
  )
BEGIN
  SELECT RAISE(ABORT, 'last_active_owner');
END;
