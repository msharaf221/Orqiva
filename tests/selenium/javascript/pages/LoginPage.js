import { By } from "selenium-webdriver";
import { BasePage } from "./BasePage.js";

/**
 * LoginPage Object for JavaScript/Node.js Selenium test suites.
 */
export class LoginPage extends BasePage {
  static PAGE_URL = "https://the-internet.herokuapp.com/login";

  // Locators
  static USERNAME_INPUT = By.id("username");
  static PASSWORD_INPUT = By.id("password");
  static SUBMIT_BUTTON = By.css("button[type='submit']");
  static FLASH_ALERT = By.id("flash");
  static LOGOUT_BUTTON = By.css("a[href='/logout']");

  constructor(driver, timeoutMs = 15000) {
    super(driver, timeoutMs);
  }

  async load() {
    await this.open(LoginPage.PAGE_URL);
    return this;
  }

  async login(username, password) {
    await this.typeText(LoginPage.USERNAME_INPUT, username);
    await this.typeText(LoginPage.PASSWORD_INPUT, password);
    await this.click(LoginPage.SUBMIT_BUTTON);
    return this;
  }

  async getFlashMessage() {
    return await this.getText(LoginPage.FLASH_ALERT);
  }

  async logout() {
    await this.click(LoginPage.LOGOUT_BUTTON);
    return this;
  }
}
