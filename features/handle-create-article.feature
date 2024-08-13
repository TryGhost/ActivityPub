Feature: Create(Article)
  We want to handle Create(Article) activities in the Inbox

  Scenario: We recieve a Create(Article) activity from someone we follow
    Given an Actor "Alice"
    Given a "Create(Article)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is in our Inbox
