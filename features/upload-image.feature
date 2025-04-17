  Feature: Image Upload API
  As an authenticated user
  I want to upload images

  Scenario: Upload an image
    When an authenticated "post" request is made to "/.ghost/activitypub/upload/image" with a file
    Then the request is accepted with a 200
    And the response contains a file URL
