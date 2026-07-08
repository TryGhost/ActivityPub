Feature: Resolve a Ghost post to its ActivityPub object

  Scenario: A Ghost post is resolved to its ActivityPub object by its UUID
    Given a "post.published" webhook
    When it is sent to the webhook endpoint
    Then the request is accepted
    When the ActivityPub object for the Ghost post is requested
    Then we are redirected to an ActivityPub article

  Scenario: An unknown Ghost post cannot be resolved
    When the ActivityPub object for an unknown Ghost post is requested
    Then the request is rejected with a 404
