Feature: Notifications
  In order to know when someone in the Fediverse interacts with me or my content
  As a user
  I want to be able to receive notifications of the interactions

  Scenario: Requests for notifications with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/notifications?limit=200"
    Then the request is rejected with a 400

  Scenario: Requests for unread notifications count
    Given we are following "Alice"
    And we are not following "Bob"
    When we get a like notification from "Alice"
    And we get a like notification from "Bob"
    And we get a reply notification from "Alice"
    And we get a reply notification from "Bob"
    Then the unread notifications count is 4

  Scenario: Reset unread notifications count
    Given we are following "Alice"
    And we are not following "Bob"
    And we get a like notification from "Alice"
    And we get a like notification from "Bob"
    And we get a reply notification from "Alice"
    And we get a reply notification from "Bob"
    And the unread notifications count is 4
    When we reset unread notifications count
    Then the unread notifications count is 0
