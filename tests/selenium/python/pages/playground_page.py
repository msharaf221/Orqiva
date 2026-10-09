from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from .base_page import BasePage

class PlaygroundPage(BasePage):
    """
    Page Object for LambdaTest Selenium Playground Form Demo.
    URL: https://www.lambdatest.com/selenium-playground/simple-form-demo
    """
    PAGE_URL = "https://www.lambdatest.com/selenium-playground/simple-form-demo"

    # Single input field locators
    USER_MESSAGE_INPUT = (By.ID, "user-message")
    SHOW_INPUT_BUTTON = (By.ID, "showInput")
    DISPLAYED_MESSAGE = (By.ID, "message")

    # Two input fields (addition calculator) locators
    SUM1_INPUT = (By.ID, "sum1")
    SUM2_INPUT = (By.ID, "sum2")
    GET_SUM_BUTTON = (By.CSS_SELECTOR, "form#gettotal button")
    TOTAL_DISPLAY = (By.ID, "addmessage")

    def __init__(self, driver: WebDriver, timeout_seconds: float = 15.0):
        super().__init__(driver, timeout_seconds)

    def load(self) -> "PlaygroundPage":
        self.open(self.PAGE_URL)
        return self

    def submit_user_message(self, message: str) -> "PlaygroundPage":
        self.type_text(self.USER_MESSAGE_INPUT, message)
        self.click(self.SHOW_INPUT_BUTTON)
        return self

    def get_displayed_message(self) -> str:
        return self.get_text(self.DISPLAYED_MESSAGE).strip()

    def calculate_sum(self, num1: int, num2: int) -> "PlaygroundPage":
        self.type_text(self.SUM1_INPUT, str(num1))
        self.type_text(self.SUM2_INPUT, str(num2))
        self.click(self.GET_SUM_BUTTON)
        return self

    def get_total_result(self) -> str:
        return self.get_text(self.TOTAL_DISPLAY).strip()
