Feature: We automatically accept Follow requests

  Scenario: We can be followed
    Given an Actor "Alice"
    Given a "Follow(Us)" Activity "F" by "Alice"
    When "Alice" sends "F" to the Inbox
    Then an "Accept(F)" Activity "A" is created by "Us"
    And Activity "A" is sent to "Alice"
    And "Alice" is in our Followers
