SELECT 
    accounts.name AS following_name,
    accounts.username AS following_username,
    accounts.description AS following_description,
    accounts.icon AS following_icon
FROM 
    follows
INNER JOIN accounts ON follows.following_id = accounts.internal_id
WHERE 
    follows.follower_id = 1
ORDER BY 
    follows.internal_id DESC
LIMIT 50
OFFSET 0;