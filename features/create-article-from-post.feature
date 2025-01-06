Feature: Deliver Create(Article) activities when a post.published webhook is received

  Scenario: We recieve a webhook for the post.published event
    Given a valid "post.published" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then a "Create(Article)" activity is in the Outbox
    And the found "Create(Article)" has property "object.attributedTo"

  Scenario: We recieve a webhook for the post.published event and the post has no content
    Given a valid "post.published(no content)" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then a "Create(Article)" activity is in the Outbox
    And the found "Create(Article)" has property "object.attributedTo"

  Scenario: We recieve a webhook for the post.published event with an old signature
    Given a valid "post.published" webhook
    When it is sent to the webhook endpoint with an old signature
    Then the request is rejected with a 401

  Scenario: We recieve a webhook for the post.published event without a signature
    Given a valid "post.published" webhook
    When it is sent to the webhook endpoint without a signature
    Then the request is rejected with a 401

  Scenario: We recieve a webhook for the post.published event with a non-public post
    Given a valid "post.published" webhook:
      | property                | value |
      | post.current.visibility | paid  |
    When it is sent to the webhook endpoint
    Then the request is accepted
    And a "Create(Article)" activity is not in the Outbox after 5 seconds
