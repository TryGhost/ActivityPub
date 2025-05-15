Feature: Create(Note<inReplyTo>)
  We want to handle incoming replies to our content and add them to the inbox.

  Scenario: We recieve a reply to our content from someone we don't follow
    Given we are not following "Alice"
    And we publish an article
    When "Alice" sends us a reply to our article
    Then the reply is in our notifications