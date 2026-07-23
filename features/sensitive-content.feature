Feature: Ingesting sensitive content
  Sensitive posts from remote servers carry their content warning in the
  ActivityPub summary field. When we ingest a sensitive post we treat the
  summary as a content warning rather than a post excerpt.

  Scenario: We receive a sensitive Note from someone we follow
    Given we are following "Alice"
    And a sensitive "Create(Note)" Activity "A" by "Alice" with content warning "Eye contact"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    And the "A" in our feed is sensitive with content warning "Eye contact"

  Scenario: We receive a sensitive Article from someone we follow
    Given we are following "Alice"
    And a sensitive "Create(Article)" Activity "B" by "Alice" with content warning "Discusses violence"
    When "Alice" sends "B" to the Inbox
    Then the request is accepted
    And the "B" in our feed is sensitive with content warning "Discusses violence"
