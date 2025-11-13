Feature: Incoming mentions

    Scenario: We receive a mention from someone
        Given an Actor "Person(Alice)"
        When "Alice" sends us a mention
        Then the mention is in our notifications
