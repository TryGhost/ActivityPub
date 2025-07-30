Feature: Disabling a site

  Scenario: Disabling a site prevents access to the outbox
    When we disable the site
    And we request the outbox
    Then the request is rejected with a 403

  Scenario: Disabling a site prevents access to the followers collection
    When we disable the site
    And we request the followers collection
    Then the request is rejected with a 403

  Scenario: Disabling a site prevents access to the following collection
    When we disable the site
    And we request the following collection
    Then the request is rejected with a 403

  Scenario: Disabling a site prevents access to the liked collection
    When we disable the site
    And we request the liked collection
    Then the request is rejected with a 403

  Scenario: Disabling a site prevents the webfinger lookup
    When we disable the site
    And we request the webfinger
    Then the request is rejected with a 403

  Scenario: Disabled site can not be followed
    Given an Actor "Person(Alice)"
    Given a "Follow(Us)" Activity "Follow" by "Alice"
    When we disable the site
    And "Alice" sends "Follow" to the Inbox
    Then the request is rejected with a 403

  Scenario: Disabled site can not be re-enabled
    When we disable the site
    And we request the site endpoint
    And the request is accepted
    And we request the webfinger
    Then the request is accepted
