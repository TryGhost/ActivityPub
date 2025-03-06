Feature: Thread
  In order to see replies to a post
  As a user
  I want to request the thread for a post

  Background:
    Given we are following "Alice"
    And we are followed by "Alice"
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

  Scenario: Retrieving the thread for a top level post that has replies that have been deleted
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
    And we reply "Reply3" to "Article" with the content
        """
        This is probably the best article I have ever read!
        """
    And "Reply3" is in our Outbox
    And we reply "Reply4" to "Article" with the content
        """
        Maybe its just an ok article after all!
        """
    And "Reply4" is in our Outbox
    And an authenticated "delete" request is made to "/.ghost/activitypub/post/Reply2"
    And the request is accepted
    And an authenticated "delete" request is made to "/.ghost/activitypub/post/Reply4"
    And the request is accepted
    When an authenticated request is made to "/.ghost/activitypub/thread/Article"
    Then the request is accepted
    And the thread contains "3" posts
    And post "1" in the thread is "Article"
    And post "2" in the thread is "Reply1"
    And post "3" in the thread is "Reply3"

  Scenario: Retrieving the thread for a reply to a post that has been deleted
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
    And an authenticated "delete" request is made to "/.ghost/activitypub/post/Reply1"
    And the request is accepted
    When an authenticated request is made to "/.ghost/activitypub/thread/Reply3"
    Then the request is accepted
    And the thread contains "3" posts
    And post "1" in the thread is "Article"
    And post "2" in the thread is "Reply1"
    And post "3" in the thread is "Reply3"
    And post "2" has "type" set to "2"
    And post "2" has "title" set to ""
    And post "2" has "content" set to ""
