@regression
Feature: We do not 5xx error for previously known regressions

  Scenario: We do not throw a 5xx when we receive invalid @context values
    Given we are sent invalid @context values to the inbox
    Then we respond with a 400

  Scenario: We do not throw a 5xx when we receive nested invalid @context values
    Given we are sent invalid nested @context values to the inbox
    Then we respond with a 400

  Scenario: We do not throw a 5xx when we receive an invalid url
    Given we are sent invalid url to the inbox
    Then we respond with a 400

  Scenario: We do not throw a 5xx when we receive an invalid type
    Given we are sent invalid type to the inbox
    Then we respond with a 400

  Scenario: We do not throw a 5xx when we receive a second publish webhook
    Given we are sent a publish webhook
    When we are sent a second publish webhook for the same post
    Then we respond with a 400

