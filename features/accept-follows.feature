Feature: We automatically accept Follow requests

  Scenario: We can be followed
    Given an Actor "Person(Alice)"
    Given a "Follow(Us)" Activity "F" by "Alice"
    When "Alice" sends "F" to the Inbox
    And "F" is in our Inbox
    Then an "Accept(F)" Activity "A" is created by "Us"
    And Activity "A" is sent to "Alice"
    And "Alice" is in our Followers

  Rule: We can be followed multiple times by the same actor, but we only record them once
    Example: An actor attempts to follow us multiple times
      Given an Actor "Person(Alice)"
      And a "Follow(Us)" Activity "F1" by "Alice"
      And a "Follow(Us)" Activity "F2" by "Alice"
      When "Alice" sends "F1" to the Inbox
      And "F1" is in our Inbox
      And "Alice" sends "F2" to the Inbox
      And "F2" is in our Inbox
      Then an "Accept(F1)" Activity "A1" is created by "Us"
      And an "Accept(F2)" Activity "A2" is created by "Us"
      And Activity "A1" is sent to "Alice"
      And Activity "A2" is sent to "Alice"
      And "Alice" is in our Followers once only
