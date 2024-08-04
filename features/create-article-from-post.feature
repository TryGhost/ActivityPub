Feature: Deliver Create(Article) activities when a post.published webhook is received

  Scenario: We recieve a webhook for the post.published event
    Given a valid "post.published" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then a "Create(Article)" activity is in the Outbox
