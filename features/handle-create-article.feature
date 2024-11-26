Feature: Create(Article)
  We want to handle Create(Article) activities in the Inbox

  Scenario: We recieve a Create(Article) activity from someone we follow
    Given a Person "Alice"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is in our Inbox

  Scenario: We recieve a Create(Article) activity from someone we don't follow
    Given a Person "Alice"
    Given a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is not in our Inbox
