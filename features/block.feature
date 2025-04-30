Feature: Blocking accounts

  Scenario: Request to follow from blocked account is rejected
    Given an Actor "Person(Alice)"
    And a "Follow(Us)" Activity "F" by "Alice"
    When we block "Alice"
    And "Alice" sends "F" to the Inbox
    Then an "Reject(F)" Activity "R" is created by "Us"
    And Activity "R" is sent to "Alice"
    And "Alice" is not in our Followers
