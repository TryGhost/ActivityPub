Feature: Create(Note<inReplyTo>)
  We want to handle incoming replies to our content and add them to the inbox.

  Scenario: We recieve a Create(Note) in response to our content from someone we don't follow
    # Setup our article
    Given a valid "post.published" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    Then a "Create(Article)" activity is in the Outbox

    Given the found "Create(Article)" as "ArticleCreate(OurArticle)"

    Given an Actor "Person(Alice)"
    Given a "Note" Object "Reply" by "Alice"
    And "Reply" is a reply to "OurArticle"
    And a "Create(Reply)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is in our Inbox
