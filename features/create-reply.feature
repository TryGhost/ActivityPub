Feature: Creating a reply
  Background:
    Given we are following "Alice"
    And we are followed by "Alice"
    And we are followed by "Bob"
    And a "Note" Object "Article" by "Alice"
    And a "Create(Article)" Activity "Create" by "Alice"
    And "Alice" sends "Create" to the Inbox
    And "Create" is in our Inbox

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
    Then "Reply" is in our Outbox

  Scenario: Created reply has user provided HTML escaped
    When we reply "Reply" to "Article" with the content
      """
      This is a great article!<script>alert("Hello, world!");</script>
      """
    Then "Reply" is in our Outbox
    And "Reply" has the content "This is a great article!&lt;script&gt;alert(&quot;Hello, world!&quot;);&lt;&#x2F;script&gt;"

  Scenario: Created reply is sent to followers
    When we reply "Reply" to "Create" with the content
      """
      This is a great article!
      """
    Then Activity "Reply" is sent to "Alice"
    And Activity "Reply" is sent to "Bob"
