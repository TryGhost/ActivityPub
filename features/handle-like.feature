Feature: Like(Article)
  We want to handle Like(Article) activities in the Inbox

  Scenario: We receive a Like(Article) activity from someone
    Given an Actor "Person(Alice)"
    And an Actor "Person(Bob)"
    And a "Create(Article)" Activity "Create(A)" by "Alice"
    And a "Like(A)" Activity "L" by "Bob"
    When "Bob" sends "L" to the Inbox
    Then "L" is in our Inbox
