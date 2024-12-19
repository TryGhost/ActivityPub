SELECT 
    accounts.name AS follower_name,
    accounts.username AS follower_username,
    accounts.description AS follower_description,
    accounts.icon AS follower_icon
FROM 
    follows
INNER JOIN accounts ON follows.follower_id = accounts.internal_id
WHERE 
    follows.following_id = 1
ORDER BY 
    follows.internal_id DESC
LIMIT 50
OFFSET 0;