import pytest
from pages.playground_page import PlaygroundPage

class TestCloudPlayground:
    """
    LambdaTest Selenium Playground Cloud Test Suite.
    Verifies dynamic user inputs, DOM updates, and calculations on cloud browsers.
    """

    def test_single_input_message_display(self, driver):
        playground = PlaygroundPage(driver).load()
        test_message = "Automated with Selenium Skill on LambdaTest Cloud!"

        playground.submit_user_message(test_message)

        displayed = playground.get_displayed_message()
        assert displayed == test_message, (
            f"Expected displayed message to equal '{test_message}', got '{displayed}'"
        )

    def test_two_input_fields_addition(self, driver):
        playground = PlaygroundPage(driver).load()
        a = 25
        b = 17
        expected_sum = str(a + b)

        playground.calculate_sum(a, b)

        actual_sum = playground.get_total_result()
        assert actual_sum == expected_sum, (
            f"Expected sum output to be '{expected_sum}', got '{actual_sum}'"
        )
