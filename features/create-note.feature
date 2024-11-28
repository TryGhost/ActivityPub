Feature: Creating a note

  Scenario: Note content is validated against being empty
    When we attempt to create a note with no content
    Then the request is rejected with a 400

  Scenario: Note content is validated against being invalid
    When we attempt to create a note with invalid content
    Then the request is rejected with a 400

  Scenario: Created note is added to the Outbox
    When we create a note "Note" with the content
      """
      Hello, world!
      """
    Then "Note" is in our Outbox

  Scenario: Created note is formatted
    When we create a note "Note" with the content
      """
      Hello
      World
      """
    Then "Note" is in our Outbox
    And "Note" has the content "<p>Hello<br />World</p>"

  Scenario: Created note is sent to followers
    Given an Actor "Person(Alice)"
    And an Actor "Person(Bob)"
    And a "Follow(Us)" Activity "F1" by "Alice"
    And a "Follow(Us)" Activity "F2" by "Bob"
    And "Alice" sends "F1" to the Inbox
    And "F1" is in our Inbox
    And "Bob" sends "F2" to the Inbox
    And "F2" is in our Inbox
    When we create a note "Note" with the content
      """
      Hello, world!
      """
    Then Activity "Note" is sent to "Alice"
    And Activity "Note" is sent to "Bob"
