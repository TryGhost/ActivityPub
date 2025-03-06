Feature: Create(Article)
  We want to handle Delete(Note) activities in the Inbox

  Background:
    Given an Actor "Person(James)"
    Given an Actor "Person(Bob)"
    Given we follow "Bob"
    Then the request is accepted
    Given a "Accept(Follow(Bob))" Activity "Accept" by "Bob"
    And "Bob" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given an Actor "Person(Alice)"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    When "Alice" sends "AliceNote" to the Inbox
    Then the request is accepted
    Then "AliceNote" is in our Inbox
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And the feed contains "AliceNote"

  @only
  Scenario: We recieve a Delete(Note) activity from someone we follow
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Alice"
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And the feed does not contain "AliceNote"

  @only
  Scenario: We recieve a Delete(Note) activity from someone who didn't create the post
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "Bob"
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And the feed contains "AliceNote"
    
  @only
  Scenario: We recieve a Delete(Note) activity from someone we don't follow
    Given a "Delete(AliceNote)" Activity "DeleteNote" by "James"
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And the feed contains "AliceNote"

