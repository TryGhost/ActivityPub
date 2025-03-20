Feature: Notifications
  In order to know when someone in the Fediverse interacts with me or my content
  As a user
  I want to be able to receive notifications of the interactions

  Scenario: Requests for notifications with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/notifications?limit=200"
    Then the request is rejected with a 400
