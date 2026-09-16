-- Condition alerts (an ongoing state re-checked every pass) were counted as a
-- new occurrence on every worker cycle. Reset the open ones so the count again
-- reflects how many times the condition began.
UPDATE "alerts"
SET "occurrences" = 1
WHERE "status" <> 'resolved'
  AND "kind" IN ('device_offline', 'peer_flapping', 'firewall_sync_failed');
