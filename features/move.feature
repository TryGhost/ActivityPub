Feature: Migrating follows when a remote account moves

  Scenario: We follow the new account when a followed account moves
    Given an Actor "Person(Alice)"
    And an Actor "Person(AliceNew)" with alias "Alice"
    And we are following "Alice"
    And a "Move(Alice)" Activity "Move" by "Alice" with target "AliceNew"
    When "Alice" sends "Move" to the Inbox
    Then a "Follow(AliceNew)" activity is sent to "AliceNew"
    And a "Undo(Follow)" activity is sent to "Alice"
    And "AliceNew" is in our following
    And "Alice" is not in our following
