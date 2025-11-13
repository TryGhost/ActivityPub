Feature: Incoming mentions

    Scenario: We receive a public mention from someone
        Given an Actor "Person(Alice)"
        When "Alice" sends us a public mention
        And the mention is in our notifications

    Scenario: We receive a private mention from someone
        Given an Actor "Person(Alice)"
        When "Alice" sends us a private mention
        And the mention is not in our notifications
