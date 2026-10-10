from typing import Tuple
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.remote.webelement import WebElement

class BasePage:
    """
    BasePage following production-grade Selenium patterns:
    - Strictly explicit WebDriverWait
    - Zero Thread.sleep / time.sleep
    - Encapsulated element interactions
    - Overlay/cookie dialog resilience and automatic viewport scrolling
    """

    def __init__(self, driver: WebDriver, timeout_seconds: float = 15.0):
        self.driver = driver
        self.timeout = timeout_seconds
        self.wait = WebDriverWait(self.driver, self.timeout)

    def open(self, url: str) -> None:
        self.driver.get(url)
        self.dismiss_overlays_if_present()

    def dismiss_overlays_if_present(self) -> None:
        """Removes cookie consent dialogs (e.g. Cookiebot) if they obscure test elements."""
        try:
            self.driver.execute_script("""
                const ids = ['CybotCookiebotDialog', 'CybotCookiebotDialogBodyUnderlay'];
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.remove();
                });
            """)
        except Exception:
            pass

    def wait_for_element_visible(self, locator: Tuple[str, str]) -> WebElement:
        return self.wait.until(EC.visibility_of_element_located(locator))

    def wait_for_element_clickable(self, locator: Tuple[str, str]) -> WebElement:
        return self.wait.until(EC.element_to_be_clickable(locator))

    def wait_for_element_present(self, locator: Tuple[str, str]) -> WebElement:
        return self.wait.until(EC.presence_of_element_located(locator))

    def wait_for_url_contains(self, fraction: str) -> bool:
        return bool(self.wait.until(EC.url_contains(fraction)))

    def scroll_into_view(self, locator: Tuple[str, str]) -> WebElement:
        element = self.wait_for_element_present(locator)
        self.driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", element)
        return element

    def click(self, locator: Tuple[str, str]) -> None:
        self.dismiss_overlays_if_present()
        element = self.wait_for_element_clickable(locator)
        try:
            element.click()
        except Exception:
            # Fallback for dynamic overlays / sticky headers
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
            try:
                element.click()
            except Exception:
                self.driver.execute_script("arguments[0].click();", element)

    def type_text(self, locator: Tuple[str, str], text: str, clear_first: bool = True) -> None:
        self.dismiss_overlays_if_present()
        element = self.wait_for_element_visible(locator)
        if clear_first:
            element.clear()
        element.send_keys(text)

    def get_text(self, locator: Tuple[str, str]) -> str:
        element = self.wait_for_element_visible(locator)
        return element.text

    def is_visible(self, locator: Tuple[str, str]) -> bool:
        try:
            return self.wait_for_element_visible(locator).is_displayed()
        except Exception:
            return False
