Feature: Like(Article)
  We want to handle Like(Article) activities in the Inbox

  Scenario: We recieve a Like(Article) activity from someone we follow
    Given an Actor "Alice"
    And an Actor "Bob"
    And a "Create(Article)" Activity "A" by "Alice"
    And a "Like(A)" Activity "L" by "Bob"
    When "Bob" sends "L" to the Inbox
    Then "L" is in our Inbox
