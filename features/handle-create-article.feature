Feature: Create(Article)
  We want to handle Create(Article) activities in the Inbox

  Scenario: We recieve a Create(Article) activity from someone we follow
    Given we are following "Alice"
    And a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox

  Scenario: We recieve a Create(Article) activity from someone we don't follow
    Given an Actor "Person(Alice)"
    And a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
