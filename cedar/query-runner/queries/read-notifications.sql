SELECT
  notifications.internal_id AS notification_internal_id,
  notifications.created_at AS notification_created_at,
  notifications.event_type AS notification_event_type,
  notifications.user_id AS notification_user_id,
  notifications.account_id AS notification_account_id,
  notifications.post_id AS notification_post_id,
  notifications.reply_post_id AS notification_reply_post_id,
  accounts.name AS account_name,
  accounts.username AS account_username,
  accounts.description AS account_description,
  accounts.icon AS account_icon,
  posts.title AS post_title,
  posts.content AS post_content,
  posts.type AS post_type
FROM
  notifications
LEFT JOIN
  posts on posts.internal_id = notifications.post_id
LEFT JOIN
  posts AS reply_posts on reply_posts.internal_id = notifications.reply_post_id
INNER JOIN
  accounts on accounts.internal_id = notifications.account_id
WHERE -- We can only filter on columns in `notifications` table
  notifications.user_id = 2340
AND
  notifications.internal_id < 20 -- the cursor for pagination
ORDER BY -- We can only order on columns in `notifications table`
  notifications.internal_id DESC
LIMIT
  20;
