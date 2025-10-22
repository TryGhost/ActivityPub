Feature: Global Feed

  Background:
    Given we are not following "Alice"

  Scenario: Global feed includes articles from unfollowed accounts
    Given a "Create(Article)" Activity "Article1" by "Alice"
    When "Alice" sends "Article1" to the Inbox
    Then the article "Article1" is in our global feed

  Scenario: Global feed excludes notes
    Given a "Create(Note)" Activity "Note1" by "Alice"
    When "Alice" sends "Note1" to the Inbox
    Then the note "Note1" is not in our global feed
