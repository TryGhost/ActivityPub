@api
Feature: Search
    In order to find the details of an actor
    As an API user
    I want to be able to search for an actor

    Scenario: Succesfully searching for an actor
        Given an Actor "Alice"
        When I search for "Alice"
        Then the response has a 200 status code
        And the response body contains search results for "Alice"
