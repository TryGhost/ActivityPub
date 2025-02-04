Feature: Get site data
  Scenario: It will 403 without authentication
    When an unauthenticated request is made to "/.ghost/activitypub/site"
    Then the request is rejected with a 403

  Scenario: It will respond with authentication
    When an authenticated request is made to "/.ghost/activitypub/site"
    Then the request is accepted
