Feature: Notifications
  In order to know when someone in the Fediverse interacts with me or my content
  As a user
  I want to be able to receive notifications of the interactions

  Scenario: Requests for notifications with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/v1/notifications?limit=200"
    Then the request is rejected with a 400

  Scenario: New notifications are marked as unread
    Given we are following "Alice"
    And we are not following "Bob"
    When we get a like notification from "Alice"
    And we get a reply notification from "Bob"
    Then we have unread notifications

  Scenario: Visiting the notifications page marks notifications as read
    Given we are following "Alice"
    And we are not following "Bob"
    And we get a like notification from "Alice"
    And we get a reply notification from "Bob"
    And we have unread notifications
    When we visit the notifications page
    Then all notifications are marked as read
