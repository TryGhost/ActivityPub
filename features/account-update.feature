Feature: Update account information
  Background:
    Given we are followed by "Alice"

  Scenario: Update account information
    Given an authenticated "put" request is made to "/.ghost/activitypub/v1/account" with the data:
      | name           | Updated Name                    |
      | bio            | Updated bio                     |
      | username       | updatedUsername                 |
      | avatarUrl      | https://example.com/avatar.jpg  |
      | bannerImageUrl | https://example.com/banner.jpg  |
    And the request is accepted with a 200
    When an authenticated "get" request is made to "/.ghost/activitypub/v1/account/me"
    Then the request is accepted with a 200
    And the response contains the account details:
      | name           | Updated Name                                 |
      | bio            | Updated bio                                  |
      | avatarUrl      | https://example.com/avatar.jpg               |
      | bannerImageUrl | https://example.com/banner.jpg               |
      | handle         | @updatedUsername@self.test |
    And a "Update(Us)" activity is sent to "Alice"

  Scenario: Delivering account updates to internal accounts
    Given I have internal account followers
    When I update my account information
    Then alice can view my updated account information
