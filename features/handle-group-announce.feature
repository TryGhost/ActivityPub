Feature: Handling activities announced by a Group
  Background:
    Given an Actor "Person(Alice)"
    And we are following "Group(Wonderland)"

  Scenario: We recieve a Create(Article) activity announced by a Group
    Given a "Create(Article)" Activity "Create" by "Alice"
    And a "Announce(Create)" Activity "Announce" by "Wonderland"
    When "Wonderland" sends "Announce" to the Inbox

  Scenario: We recieve a Create(Article) activity with a tampered object announced by a Group
    Given an Actor "Person(Bob)"
    And a "Note" Object "Spam" by "Bob"
    And a "Article" Object "Article" by "Alice"
    And a "Create(Article)" Activity "Create" by "Alice"
    And "Create" has Object "Spam"
    And a "Announce(Create)" Activity "Announce" by "Wonderland"
    When "Wonderland" sends "Announce" to the Inbox
