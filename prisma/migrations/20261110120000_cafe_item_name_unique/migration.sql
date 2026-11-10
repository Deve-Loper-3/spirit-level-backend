-- Deduplicate case-insensitive item names before enforcing uniqueness.
-- Keep the oldest row's name; suffix later duplicates with a short id fragment.
WITH ranked AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (PARTITION BY LOWER(name) ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "cafe_items"
)
UPDATE "cafe_items" AS i
SET name = i.name || ' (' || SUBSTRING(i.id FROM 1 FOR 8) || ')'
FROM ranked AS r
WHERE i.id = r.id
  AND r.rn > 1;

-- Case-insensitive unique index on LOWER(name)
CREATE UNIQUE INDEX "cafe_items_name_lower_idx" ON "cafe_items" (LOWER("name"));
