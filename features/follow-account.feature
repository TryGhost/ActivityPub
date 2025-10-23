Feature: Follow accounts from their handle

  Scenario: We can follow an account only once
    Given we are following "Alice"
    When we follow "Alice"
    Then the request is rejected with a 409

  Scenario: We cannot follow ourselves
    Given we follow "Us"
    Then the request is rejected with a 400

  Scenario: We can unfollow an account
    Given we are following "Alice"
    And the object "Alice" should be in the "following" collection
    When we unfollow "Alice"
    Then the request is accepted
    And the object "Alice" should not be in the "following" collection
    And a "Undo(Follow)" activity is sent to "Alice"

  Scenario: We can follow an internal account
    When we follow "Alice.Internal"
    And the request is accepted
    Then "Alice.Internal" is in our following
    And we are in "Alice.Internal"'s followers

  Scenario: We can unfollow an internal account
    Given we are following "Alice.Internal"
    When we unfollow "Alice.Internal"
    And the request is accepted
    Then "Alice.Internal" is not in our following
    And we are not in "Alice.Internal"'s followers
