Feature: Handling Create activities announced by a Group
  When a Group announces a Create activity from one of its members,
  followers of the Group should see the post in their feed even if
  they don't follow the original author

  Background:
    Given an Actor "Person(Charlie)"
    And we are following "Group(Wonderland)"

  Scenario: We receive an announced create note activity from a group we follow
    Given a "Create(Note)" Activity "N" by "Charlie" with content "Hello from the group member"
    When "Wonderland" announces "N"
    Then the note "N" is in our feed
    And the note "N" is reposted by "Wonderland"

  Scenario: We receive an announced create article activity from a group we follow
    Given a "Create(Article)" Activity "A" by "Charlie"
    When "Wonderland" announces "A"
    Then the article "A" is in our Inbox feed
    And the article "A" is reposted by "Wonderland"

  Scenario: The announced post is not shown if we don't follow the group
    Given an Actor "Group(Unknown)"
    And we are not following "Unknown"
    And a "Create(Note)" Activity "N" by "Charlie" with content "You shouldn't see this"
    When "Unknown" announces "N"
    Then the note "N" is not in our feed
