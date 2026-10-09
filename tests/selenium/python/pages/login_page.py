from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from .base_page import BasePage

class LoginPage(BasePage):
    """
    Page Object for the Authentication / Login workflow.
    Adheres to selenium-skill Locator Priority:
    1. By.ID
    2. By.NAME
    3. By.CSS_SELECTOR
    """
    PAGE_URL = "https://the-internet.herokuapp.com/login"

    # Locators (IDs and CSS selectors prioritized)
    USERNAME_INPUT = (By.ID, "username")
    PASSWORD_INPUT = (By.ID, "password")
    SUBMIT_BUTTON = (By.CSS_SELECTOR, "button[type='submit']")
    FLASH_ALERT = (By.ID, "flash")
    LOGOUT_BUTTON = (By.CSS_SELECTOR, "a[href='/logout']")

    def __init__(self, driver: WebDriver, timeout_seconds: float = 15.0):
        super().__init__(driver, timeout_seconds)

    def load(self) -> "LoginPage":
        self.open(self.PAGE_URL)
        return self

    def login(self, username: str, password: str) -> "LoginPage":
        self.type_text(self.USERNAME_INPUT, username)
        self.type_text(self.PASSWORD_INPUT, password)
        self.click(self.SUBMIT_BUTTON)
        return self

    def get_flash_message(self) -> str:
        return self.get_text(self.FLASH_ALERT).strip()

    def is_logout_button_present(self) -> bool:
        return self.is_visible(self.LOGOUT_BUTTON)

    def logout(self) -> "LoginPage":
        self.click(self.LOGOUT_BUTTON)
        return self
