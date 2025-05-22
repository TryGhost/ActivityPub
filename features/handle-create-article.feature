Feature: Create(Article)
  We want to handle Create(Article) activities in the Inbox

  Scenario: We receive a Create(Article) activity from someone we follow
    Given we are following "Alice"
    And a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    And the article "A" is in our inbox

  Scenario: We receive a Create(Article) activity from someone we don't follow
    Given an Actor "Person(Bob)"
    And a "Create(Article)" Activity "B" by "Bob"
    When "Bob" sends "B" to the Inbox
    Then the request is accepted
    And the article "B" is not in our inbox
