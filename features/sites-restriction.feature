Feature: Site based restriction

  Scenario: A request is made without an entry in the sites table
    Given there is no entry in the sites table
    When we request the outbox
    Then the request is rejected with a 403

  Scenario: An entry to the sites table can be added
    Given there is no entry in the sites table
    When we request the site endpoint
    Then the request is accepted
    And we request the outbox
    Then the request is accepted
