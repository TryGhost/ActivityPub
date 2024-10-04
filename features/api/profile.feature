@api
Feature: Profile
    In order to view the details of a profile
    As an API user
    I want to be able to retrieve a profile

    Scenario: Succesfully retreiving a profile
        Given an Actor "Alice"
        When I request the profile for "Alice"
        Then the response has status code 200
        And the response body is a valid profile
