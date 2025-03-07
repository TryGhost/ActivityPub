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
    Then the object "Alice" should not be in the "following" collection
    Then Activity "Unfollow(Alice)" is sent to "Alice"
