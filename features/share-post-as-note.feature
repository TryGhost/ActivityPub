Feature: Choose how a Ghost post is shared to the Fediverse

  Scenario: A post shared as a note is delivered as a Create(Note)
    Given we are followed by "Alice"
    And a "post.published" webhook:
      | property                      | value |
      | post.current.social_web_share | note  |
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then A "Create(Note)" Activity is sent to all followers

  Scenario: A post that should not be shared is accepted without creating a post
    Given a "post.published" webhook:
      | property                      | value |
      | post.current.social_web_share | none  |
    When it is sent to the webhook endpoint
    Then the post is not shared

  Scenario: Unpublishing a post that was never shared is accepted
    Given a "post.unpublished" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted

  Scenario: Delivering notes created from posts to internal accounts
    Given I have internal account followers
    When I create a post in ghost that is shared as a note
    Then the post note is in my followers feeds

  Scenario: Editing a post that was shared as a note leaves the note unchanged
    Given I have internal account followers
    When I create a post in ghost that is shared as a note
    Then the post note is in my followers feeds
    When I update the post in ghost
    Then the post note is unchanged in my followers feeds
