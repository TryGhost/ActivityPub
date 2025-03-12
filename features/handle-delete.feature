Feature: Delete(Note)
  We want to handle Delete(Note) activities

  Background:
    Given an Actor "Person(Bob)"
    And we follow "Bob"
    And the request is accepted
    And a "Accept(Follow(Bob))" Activity "Accept" by "Bob"
    And "Bob" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And the request is accepted
    And "AliceNote" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the "feed" response contains "AliceNote"
    And the "feed" response does not contain "AliceNote"

  Scenario: We recieve a Delete(Note) activity from someone we follow
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Alice"
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the "feed" response does not contain "AliceNote"

  Scenario: We recieve a Delete(Note) activity from someone who didn't create the post
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Bob"
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the "feed" response does not contain "AliceNote"

