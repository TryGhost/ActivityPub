Feature: Handling activities announced by a Group
  Background:
    Given a Person "Alice"
    And a Group "Wonderland"
    And "Alice" is a member of "Wonderland"
    And we follow "Wonderland"
    And the request is accepted
    And a "Accept(Follow(Wonderland))" Activity "Accept" by "Wonderland"
    And "Wonderland" sends "Accept" to the Inbox

  Scenario: We recieve a Create(Article) activity announced by a Group
    When a "Create(Article)" Activity "Create" by "Alice"
    And "Wonderland" announces "Create"
    Then "Create" is in our Inbox
