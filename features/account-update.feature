Feature: Account API
  As an authenticated user
  I want to update my account information

  Scenario: Get default account
    When an authenticated "put" request is made to "/.ghost/activitypub/account" with data:
      """
      {
        "name": "Updated Name",
        "bio": "Updated bio",
        "username": "updatedUsername",
        "avatarUrl": "https://example.com/avatar.jpg",
        "bannerImageUrl": "https://example.com/banner.jpg"
      }
      """
    Then the request is accepted with a 200
