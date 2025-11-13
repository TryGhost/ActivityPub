Feature: Incoming mentions

    Scenario: We receive a Create(Note) with a mention
        Given an Actor "Person(Alice)"
        And a "Create(Note)" Activity "Note" by "Alice" with content "Hello @index@site.com" that mentions "Us"
        When "Alice" sends "Note" to the Inbox
        Then the request is accepted
