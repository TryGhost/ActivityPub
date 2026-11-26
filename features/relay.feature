Feature: Sending public posts to relays

  Scenario: Public posts are sent to relays once relay sharing is turned on
    Given we are followed by "Alice"
    And relay sharing is turned on
    Then our account has relay sharing turned on
    When we create a note "Note" with the content
      """
      Hello relays
      """
    Then Activity with object "Note" is sent to all followers
    And a "Create" activity for "Note" is sent to the relay
    When an authenticated "delete" request is made to "/.ghost/activitypub/v1/post/Note"
    Then the request is accepted with a 204
    And a "Delete" activity for "Note" is sent to the relay
