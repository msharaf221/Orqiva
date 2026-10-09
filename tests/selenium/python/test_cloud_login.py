import pytest
from pages.login_page import LoginPage

class TestCloudLogin:
    """
    Cloud Grid Authentication Test Suite.
    Runs on LambdaTest / TestMu AI cross-browser cloud infrastructure.
    """

    def test_successful_login_and_logout(self, driver):
        login_page = LoginPage(driver).load()

        # Perform login with valid test credentials
        login_page.login(username="tomsmith", password="SuperSecretPassword!")

        # Verify flash banner confirms success
        flash_text = login_page.get_flash_message()
        assert "You logged into a secure area!" in flash_text, (
            f"Expected secure area confirmation in banner, received: '{flash_text}'"
        )
        assert login_page.is_logout_button_present(), "Expected logout button to be visible."

        # Perform logout and verify returned to login page
        login_page.logout()
        logout_flash = login_page.get_flash_message()
        assert "You logged out of the secure area!" in logout_flash, (
            f"Expected logged out message, received: '{logout_flash}'"
        )

    def test_invalid_login_shows_error(self, driver):
        login_page = LoginPage(driver).load()

        # Attempt login with invalid credentials
        login_page.login(username="invalid_user", password="WrongPassword!")

        # Verify error alert
        flash_text = login_page.get_flash_message()
        assert "Your username is invalid!" in flash_text, (
            f"Expected invalid username error alert, received: '{flash_text}'"
        )
