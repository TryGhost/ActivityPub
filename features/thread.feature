Feature: Thread
  In order to see replies to a post
  As a user
  I want to request the thread for a post

  Background:
    Given an Actor "Person(Alice)"
    And a "Follow(Us)" Activity "Follow" by "Alice"
    And "Alice" sends "Follow" to the Inbox
    And "Follow" is in our Inbox
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Note" Object "Article" by "Alice"
    And a "Create(Article)" Activity "Create" by "Alice"
    And "Alice" sends "Create" to the Inbox
    And "Create" is in our Inbox

  Scenario: Retrieving the thread for a top level post
    Given we reply "Reply1" to "Article" with the content
        """
        This is a great article!
        """
    And "Reply1" is in our Outbox
    And we reply "Reply2" to "Article" with the content
        """
        This is still a great article!
        """
    And "Reply2" is in our Outbox
    And we reply "Reply3" to "Reply1" with the content
        """
        This is a great reply!
        """
    And "Reply3" is in our Outbox
    When an authenticated request is made to "/.ghost/activitypub/thread/Article"
    Then the request is accepted
    And the thread contains "3" posts
    And post "1" in the thread is "Article"
    And post "2" in the thread is "Reply1"
    And post "3" in the thread is "Reply2"

  Scenario: Retrieving the thread for a reply to a post
    Given we reply "Reply1" to "Article" with the content
        """
        This is a great article!
        """
    And "Reply1" is in our Outbox
    And we reply "Reply2" to "Article" with the content
        """
        This is still a great article!
        """
    And "Reply2" is in our Outbox
    And we reply "Reply3" to "Reply1" with the content
        """
        This is a great reply!
        """
    And "Reply3" is in our Outbox
    When an authenticated request is made to "/.ghost/activitypub/thread/Reply3"
    Then the request is accepted
    And the thread contains "3" posts
    And post "1" in the thread is "Article"
    And post "2" in the thread is "Reply1"
    And post "3" in the thread is "Reply3"
