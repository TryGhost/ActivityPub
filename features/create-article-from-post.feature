Feature: Deliver Create(Article) activities when a post.published webhook is received

  Scenario: We receive a webhook for the post.published event
    Given we are followed by "Alice"
    And a "post.published" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then A "Create(Article)" Activity is sent to all followers

  Scenario: We receive a webhook for the post.published event and the post has no content
    Given we are followed by "Alice"
    And a "post.published" webhook:
      | property             | value |
      | post.current.html    | null  |
      | post.current.excerpt | null  |
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then A "Create(Article)" Activity is sent to all followers

  Scenario: We receive a webhook for the post.published event with an old signature
    Given a "post.published" webhook
    When it is sent to the webhook endpoint with an old signature
    Then the request is rejected with a 401

  Scenario: We receive a webhook for the post.published event without a signature
    Given a "post.published" webhook
    When it is sent to the webhook endpoint without a signature
    Then the request is rejected with a 401
