Feature: Delete a post

  Scenario: Correct response code is returned
    When an authenticated "delete" request is made to "/.ghost/activitypub/post/123"
    Then the request is accepted with a 204
