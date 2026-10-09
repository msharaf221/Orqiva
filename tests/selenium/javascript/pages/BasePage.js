import { until } from "selenium-webdriver";

/**
 * BasePage adhering to selenium-skill rules:
 * - Explicit waits only
 * - No implicit waits or sleep loops
 * - Clean method abstractions
 */
export class BasePage {
  constructor(driver, timeoutMs = 15000) {
    this.driver = driver;
    this.timeoutMs = timeoutMs;
  }

  async open(url) {
    await this.driver.get(url);
  }

  async waitForElement(locator) {
    const el = await this.driver.wait(until.elementLocated(locator), this.timeoutMs);
    await this.driver.wait(until.elementIsVisible(el), this.timeoutMs);
    return el;
  }

  async click(locator) {
    const el = await this.waitForElement(locator);
    await this.driver.wait(until.elementIsEnabled(el), this.timeoutMs);
    await el.click();
  }

  async typeText(locator, text, clearFirst = true) {
    const el = await this.waitForElement(locator);
    if (clearFirst) {
      await el.clear();
    }
    await el.sendKeys(text);
  }

  async getText(locator) {
    const el = await this.waitForElement(locator);
    return (await el.getText()).trim();
  }
}
