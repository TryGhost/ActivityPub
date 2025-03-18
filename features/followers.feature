Feature: Followers

  Scenario: Activities are sent to all followers
    Given we are followed by:
      | name    | type   |
      | Alice   | Person |
      | Bob     | Person |
      | Charlie | Person |
      | Dave    | Person |
    When we create a note "Note" with the content
      """
      Hello, world!
      """
    Then Activity "Note" is sent to all followers
