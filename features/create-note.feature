Feature: Creating a note

  Scenario: Note content is validated against being empty
    When we attempt to create a note with no content
    Then the request is rejected with a 400

  Scenario: Note content is validated against being invalid
    When we attempt to create a note with invalid content
    Then the request is rejected with a 400

  Scenario: Created note is formatted
    Given we are followed by "Alice"
    When we create a note "Note" with the content
      """
      Hello
      World
      """
    Then Activity with object "Note" is sent to all followers
    And "Note" has the content "<p>Hello<br />World</p>"

  Scenario: Created note has user provided HTML escaped
    If HTML is provided as user input, it should be escaped. The content
    should still be wrapped in an unescaped <p> though.

    Given we are followed by "Alice"
    When we create a note "Note" with the content
      """
      <p>Hello, world!</p>
      <script>alert("Hello, world!");</script>
      """
    Then Activity with object "Note" is sent to all followers
    And "Note" has the content "<p>&lt;p&gt;Hello, world!&lt;/p&gt;<br />&lt;script&gt;alert(\"Hello, world!\");&lt;/script&gt;</p>"

  Scenario: Created note is sent to followers
    Given we are followed by:
      | name    | type   |
      | Alice   | Person |
      | Bob     | Person |
    When we create a note "Note" with the content
      """
      Hello, world!
      """
    Then Activity with object "Note" is sent to all followers

  Scenario: Creating a note with an image URL
    Given we are followed by "Alice"
    When we create a note "Note" with imageUrl "https://self.test/.ghost/activitypub/gcs/image.jpg" and content
      """
      Hello, world!
      """
    Then Activity with object "Note" is sent to all followers
    And "Note" has the content "<p>Hello, world!</p>"
    And note "Note" has the image URL "https://self.test/.ghost/activitypub/gcs/image.jpg"

  Scenario: Creating a note with an invalid image URL
    When we create a note "Note" with imageUrl "not-a-url" and content
      """
      Hello, world!
      """
    Then the request is rejected with a 400

  Scenario: Creating a note with an image
    Given we are followed by "Alice"
    When we create a note "Note" with an image
    Then Activity with object "Note" is sent to all followers
    And the "Note" is in our feed and has an image

  Scenario: Creating a note with an image and alt text
    Given we are followed by "Alice"
    When we create a note "Note" with an image and alt text
    Then Activity with object "Note" is sent to all followers
    And the "Note" is in our feed and has an image and alt text

  Scenario: Creating a note with an invalid image URL
    When we create a note "Note" with an invalid image url
    Then the note is not created

  Scenario: Delivering notes and mentions to internal accounts
    Given I have internal account followers
    When I create a note which mentions alice
    Then the note is in my followers feeds
    And alice receives a mention notification
