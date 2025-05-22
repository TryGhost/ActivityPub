Feature: Like(Article)
  We want to handle Like(Article) activities in the Inbox

  Scenario: We receive a Like(Article) activity from someone
    Given an Actor "Person(Alice)"
    And we publish an article
    When "Alice" likes our article
    Then the like is in our notifications
