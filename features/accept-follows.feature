Feature: We automatically accept Follow requests

  Scenario: We can be followed
    Given an Actor "Person(Alice)"
    Given a "Follow(Us)" Activity "Follow" by "Alice"
    When "Alice" sends "Follow" to the Inbox
    Then an "Accept(Follow)" Activity "Accept" is created by "Us"
    And Activity "Accept" is sent to "Alice"
    And "Alice" is in our Followers

  Rule: We can be followed multiple times by the same actor, but we only record them once
    Example: An actor attempts to follow us multiple times
      Given an Actor "Person(Alice)"
      And a "Follow(Us)" Activity "F1" by "Alice"
      And a "Follow(Us)" Activity "F2" by "Alice"
      When "Alice" sends "F1" to the Inbox
      And "Alice" sends "F2" to the Inbox
      Then an "Accept(F1)" Activity "A1" is created by "Us"
      And an "Accept(F2)" Activity "A2" is created by "Us"
      And Activity "A1" is sent to "Alice"
      And Activity "A2" is sent to "Alice"
      And "Alice" is in our Followers once only

  Scenario: We can be unfollowed
    Given an Actor "Person(Alice)"
    And a "Follow(Us)" Activity "Follow" by "Alice"
    And "Alice" sends "Follow" to the Inbox
    And an "Accept(Follow)" Activity "Accept" is created by "Us"
    And Activity "Accept" is sent to "Alice"
    And "Alice" is in our Followers
    And a "Undo(Follow)" Activity "Undo" by "Alice"
    When "Alice" sends "Undo" to the Inbox
    Then "Alice" is not in our Followers
