Feature: Site based restriction

  Scenario: A request is made without an entry in the sites table
    Given there is no entry in the sites table
    When we request the outbox
    Then the request is rejected with a 403
