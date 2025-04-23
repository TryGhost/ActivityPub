Feature: Creating a note

  Scenario: Note content is validated against being empty
    When we attempt to create a note with no content
    Then the request is rejected with a 400

  Scenario: Note content is validated against being invalid
    When we attempt to create a note with invalid content
    Then the request is rejected with a 400

  Scenario: Created note is added to the Outbox
    When we create a note "Note" with the content
      """
      Hello, world!
      """
    Then "Note" is in our Outbox

  Scenario: Created note is formatted
    When we create a note "Note" with the content
      """
      Hello
      World
      """
    Then "Note" is in our Outbox
    And "Note" has the content "<p>Hello<br />World</p>"

  Scenario: Created note has user provided HTML escaped
    If HTML is provided as user input, it should be escaped. The content
    should still be wrapped in an unescaped <p> though.

    When we create a note "Note" with the content
      """
      <p>Hello, world!</p>
      <script>alert("Hello, world!");</script>
      """
    Then "Note" is in our Outbox
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
    Then Activity "Note" is sent to all followers

  Scenario: Creating a note with an image URL
    When we create a note "Note" with imageUrl "http://localhost:4443/image.jpg" and content
      """
      Hello, world!
      """
    Then "Note" is in our Outbox
    And "Note" has the content "<p>Hello, world!</p>"
    And note "Note" has the image URL "http://localhost:4443/image.jpg"

  Scenario: Creating a note with an invalid image URL
    When we create a note "Note" with imageUrl "not-a-url" and content
      """
      Hello, world!
      """
    Then the request is rejected with a 400
