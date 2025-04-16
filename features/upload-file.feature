Feature: File Upload API
  As an authenticated user
  I want to upload files
  So that I can use them in my posts

  Scenario: Upload a file successfully
    When an authenticated "post" request is made to "/.ghost/activitypub/upload/image" with a file
    Then the request is accepted with a 200
    And the response contains a file URL
