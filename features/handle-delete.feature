Feature: Delete(Note)
  We want to handle Delete(Note) activities

  Background:
    Given we are following "Bob"
    And we are following "Alice"
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And the request is accepted
    And the note "AliceNote" is in our feed

  Scenario: We receive a Delete(Note) activity from someone we follow
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Alice"
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And "AliceNote" is not in the feed

  Scenario: We receive a Delete(Note) activity from someone who didn't create the post
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Bob"
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And "AliceNote" is not in the feed

