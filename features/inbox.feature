Feature: Inbox

  Background:
    Given we are following "Alice"

  Scenario: Inbox includes articles
    Given a "Create(Article)" Activity "Article1" by "Alice"
    When "Alice" sends "Article1" to the Inbox
    Then the article "Article1" is in our Inbox feed

  Scenario: Inbox excludes notes
    Given a "Create(Note)" Activity "Note1" by "Alice"
    When "Alice" sends "Note1" to the Inbox
    Then the note "Note1" is not in our Inbox feed
