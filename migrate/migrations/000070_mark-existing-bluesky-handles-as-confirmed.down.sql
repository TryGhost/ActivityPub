UPDATE bluesky_integration_account_handles
SET confirmed = FALSE
WHERE handle IS NOT NULL;
