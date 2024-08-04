Feature: Create(Article)
  We want to handle Create(Article) activities in the Inbox

  Scenario: We recieve a Create(Article) activity from someone we follow
    Given a valid "Create(Article)" activity
    Given the actor is "known"
    When it is sent to the Inbox
    Then the request is accepted
    Then the activity is in the Inbox
