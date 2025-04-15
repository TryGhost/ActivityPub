Feature: Update account information

  Scenario: Update account information
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
