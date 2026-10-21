-- Schedules titled by 20261019140208_schedules, or by the Dot service before
-- `titleFromPrompt`, got the first 60 characters of their prompt, often cut
-- mid-word. Retitle those rows the way `titleFromPrompt`
-- (packages/server/src/dots/schedule-policy.ts) names a task: its first
-- clause, ended at a whole word with an ellipsis past 60 characters. Only a
-- prompt longer than 60 characters could have been cut, so a title that is a
-- whole short prompt, or anything else someone typed, stays as it is.
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
  SELECT
    t."id",
    coalesce(nullif(substring(t.text FROM '(?i)^(.*?)(?<!\y(?:e\.g|i\.e|etc|vs))[.!?:;](\s|$)'), ''), t.text) AS clause
  FROM (
    SELECT "id", "title", regexp_replace("prompt", '\s+', ' ', 'g') AS spaced, btrim(regexp_replace("prompt", '\s+', ' ', 'g')) AS text
    FROM "dot_schedule"
  ) t
  WHERE length(t.text) > 60 AND t."title" IN (left(t.spaced, 60), left(t.text, 60))
) c
WHERE c."id" = s."id";
