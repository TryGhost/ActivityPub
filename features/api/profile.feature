@api
Feature: Profile
    In order to view the details of a profile
    As an API user
    I want to be able to retrieve a profile

    Scenario: Succesfully retreiving a profile
        Given an Actor "Alice"
        When I request the profile for "Alice"
        Then the response has a 200 status code
        And the response body contains the profile for "Alice"
