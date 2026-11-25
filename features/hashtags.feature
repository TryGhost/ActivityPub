Feature: Hashtags

  Scenario: Hashtags in a created note are tagged and linked to existing tag pages
    Given we are followed by "Alice"
    And the site has a tag page for "ghost"
    When we create a note "Note" with the content
      """
      Hello #Ghost and #coffee
      """
    Then "Note" is sent to "Alice" with the hashtags
      | name    | href                         |
      | #Ghost  | https://self.test/tag/ghost/ |
      | #coffee |                              |
    And "Note" has the content "<p>Hello <a href=\"https://self.test/tag/ghost/\" class=\"mention hashtag\" rel=\"tag\">#<span>Ghost</span></a> and #coffee</p>"

  Scenario: Incoming notes are listed under their hashtags
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note1" by "Alice" with the hashtag "#Fediverse"
    When "Alice" sends "Note1" to the Inbox
    Then the note "Note1" is in the hashtag feed for "#Fediverse"

  Scenario: Hashtags can be searched
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note1" by "Alice" with the hashtag "#Fediverse"
    And "Alice" sends "Note1" to the Inbox
    And the note "Note1" is in the hashtag feed for "fediverse"
    When an authenticated request is made to "/.ghost/activitypub/v1/actions/search?query=%23Fedi"
    Then the request is accepted
    And the search results contain the hashtag "fediverse"

  Scenario: Invalid hashtags are rejected
    When an authenticated request is made to "/.ghost/activitypub/v1/feed/hashtag/not%20valid"
    Then the request is rejected with a 400
