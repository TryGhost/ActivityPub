Feature: Account Move

  Scenario: We follow the new account when a followed remote account moves
    Given an Actor "Person(Alice)"
    And an Actor "Person(AliceNew)" with alias "Alice"
    And we are following "Alice"
    And a "Move(Alice)" Activity "Move" by "Alice" with target "AliceNew"
    When "Alice" sends "Move" to the Inbox
    Then a "Follow(AliceNew)" activity is sent to "AliceNew"
    And a "Undo(Follow)" activity is sent to "Alice"
    And "AliceNew" is in our following
    And "Alice" is not in our following

  Scenario: Ghost to Ghost on the same AP instance migrates followers in-process
    Given "Alice.Internal" is following Us
    And "Bob.Internal" has aliased Us
    When we migrate to "Bob.Internal"
    Then the migration is accepted
    And "Alice.Internal" is following "Bob.Internal"
    And "Alice.Internal" is not following "Us"

  Scenario: Ghost to Ghost-shaped remote migrates local followers and federates Move
    Given "Charlie.Internal" is following Us
    And we are followed by "Alice"
    And a Ghost-shaped remote Actor "Person(RemoteGhost)" with alias "Us"
    When we migrate to "RemoteGhost"
    Then the migration is accepted
    And "Charlie.Internal" is following "RemoteGhost"
    And "Charlie.Internal" is not following "Us"
    And a Move activity is sent to "Alice"

  Scenario: Ghost to Mastodon-shaped remote migrates local followers and federates Move
    Given "Charlie.Internal" is following Us
    And we are followed by "Alice"
    And an Actor "Person(MastodonNew)" with alias "Us"
    When we migrate to "MastodonNew"
    Then the migration is accepted
    And "Charlie.Internal" is following "MastodonNew"
    And "Charlie.Internal" is not following "Us"
    And a Move activity is sent to "Alice"
