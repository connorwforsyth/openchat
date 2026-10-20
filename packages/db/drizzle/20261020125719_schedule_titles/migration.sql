-- Schedules titled by 20261019140208_schedules got the first 60 characters
-- of their prompt, often cut mid-word. Retitle those rows the way
-- `titleFromPrompt` (packages/server/src/dots/schedule-policy.ts) names a
-- task: its first clause, ended at a whole word with an ellipsis past 60
-- characters. Rows someone has titled since don't match and stay as they are.
UPDATE "dot_schedule" s
SET "title" = CASE
  WHEN length(c.clause) <= 60 THEN c.clause
  ELSE regexp_replace(
    CASE
      WHEN left(c.clause, 61) ~ '\s' THEN regexp_replace(left(c.clause, 61), '\s+\S*$', '')
      ELSE left(c.clause, 59)
    END,
    '[\s,;:-]+$', ''
  ) || '…'
END
FROM (
  SELECT t."id", coalesce(nullif(substring(t.text FROM '^(.*?)[.!?:;](\s|$)'), ''), t.text) AS clause
  FROM (SELECT "id", btrim(regexp_replace("prompt", '\s+', ' ', 'g')) AS text FROM "dot_schedule") t
) c
WHERE c."id" = s."id"
  AND s."title" = left(regexp_replace(s."prompt", '\s+', ' ', 'g'), 60);
