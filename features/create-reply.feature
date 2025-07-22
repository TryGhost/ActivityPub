Feature: Creating a reply
  Background:
    Given we are following "Alice"
    And we are followed by "Alice"
    And we are followed by "Bob"
    And a "Note" Object "Article" by "Alice"
    And a "Create(Article)" Activity "Create" by "Alice"
    And "Alice" sends "Create" to the Inbox

  Scenario: Reply content is validated against being empty
    When we attempt to reply to "Article" with no content
    Then the request is rejected with a 400

  Scenario: Reply content is validated against being invalid
    When we attempt to reply to "Article" with invalid content
    Then the request is rejected with a 400

  Scenario: Reply can only be for an known object
    When we attempt to reply to an unknown object
    Then the request is rejected with a 404

  Scenario: Created reply is added to the Outbox
    When we reply "Reply" to "Article" with the content
      """
      This is a great article!
      """
    Then Activity with object "Reply" is sent to all followers
    And "Reply" has the content "<p>This is a great article!</p>"

  Scenario: Created reply contains newlines
    When we reply "Reply" to "Article" with the content
      """
      Hello
      World
      """
    Then Activity with object "Reply" is sent to all followers
    And "Reply" has the content "<p>Hello<br />World</p>"

  Scenario: Created reply has user provided HTML escaped
    When we reply "Reply" to "Article" with the content
      """
      This is a great article!<script>alert("Hello, world!");</script>
      """
    Then Activity with object "Reply" is sent to all followers
    And "Reply" has the content "<p>This is a great article!&lt;script&gt;alert(\"Hello, world!\");&lt;/script&gt;</p>"

  Scenario: Created reply is sent to followers
    When we reply "Reply" to "Create" with the content
      """
      This is a great article!
      """
    Then Activity "Reply" is sent to "Alice"
    And Activity "Reply" is sent to "Bob"

  Scenario: Creating a reply with an image URL
    When we reply "Reply" to "Article" with imageUrl "https://self.test/.ghost/activitypub/gcs/image.jpg" and content
      """
      This is a great article!
      """
    Then Activity with object "Reply" is sent to all followers
    And "Reply" has the content "<p>This is a great article!</p>"
    And note "Reply" has the image URL "https://self.test/.ghost/activitypub/gcs/image.jpg"

  Scenario: Creating a reply with an invalid image URL
    When we reply "Reply" to "Article" with imageUrl "not-a-url" and content
      """
      This is a great article!
      """
    Then the request is rejected with a 400
