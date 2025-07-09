  Feature: Image Upload API
  As an authenticated user
  I want to upload images

  Scenario: Upload an image
    When an authenticated "post" request is made to "/.ghost/activitypub/v1/upload/image" with an image
    Then the request is accepted with a 200
    And the response contains a file URL
