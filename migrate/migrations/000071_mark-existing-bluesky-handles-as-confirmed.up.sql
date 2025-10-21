UPDATE bluesky_integration_account_handles
SET confirmed = TRUE
WHERE handle IS NOT NULL;
