Feature: Update a post

  Background:
    Given I have internal account followers
    When I create a post in ghost
    Then the article is in my followers feeds

  Scenario: Delivering updated articles to internal accounts
    When I update the post in ghost
    Then the updated article is in my followers feeds