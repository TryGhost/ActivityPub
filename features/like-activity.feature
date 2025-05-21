Feature: Liking an object

  Scenario: Liking an article
    Given we are following "Alice"
    And we publish an article
    When "Alice" likes our article
    Then the like is in our notifications
    And our article is liked

  Scenario: Liking an object that has been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we like the object "Note"
    Then the request is accepted
    Then we like the object "Note"
    Then the request is rejected with a 409

  Scenario: Unliking an object that has not been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    Then we unlike the object "Note"
    Then the request is rejected with a 409

  Scenario: Unliking an object that has been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we like the object "Note"
    Then the request is accepted
    Then we unlike the object "Note"
    Then the request is accepted
    And a "Undo(Like)" activity is sent to "Alice"
