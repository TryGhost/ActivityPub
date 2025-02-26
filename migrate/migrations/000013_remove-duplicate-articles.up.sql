BEGIN;

UPDATE posts p1
JOIN posts p2 ON p1.title = p2.title AND p1.type = 1 AND p2.type = 1
SET p2.type = 3 -- Mark these rows for deletion
WHERE p1.excerpt IS NULL AND p2.excerpt IS NOT NULL;

UPDATE posts p1
JOIN posts p2 ON p1.title = p2.title AND p1.type = 1 AND p2.type = 3
SET p1.excerpt = p2.excerpt -- Copy the excerpt
WHERE p1.excerpt IS NULL AND p2.excerpt IS NOT NULL;

DELETE FROM posts WHERE type = 3; -- Delete the marked rows

COMMIT;
