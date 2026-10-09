package com.lambdatest.pages;

import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;

public class LoginPage extends BasePage {
    public static final String PAGE_URL = "https://the-internet.herokuapp.com/login";

    // Locators adhering to locator priority: ID > NAME > CSS
    private final By usernameField = By.id("username");
    private final By passwordField = By.id("password");
    private final By submitButton  = By.cssSelector("button[type='submit']");
    private final By flashAlert    = By.id("flash");
    private final By logoutButton  = By.cssSelector("a[href='/logout']");

    public LoginPage(WebDriver driver) {
        super(driver);
    }

    public LoginPage load() {
        open(PAGE_URL);
        return this;
    }

    public LoginPage login(String username, String password) {
        typeText(usernameField, username);
        typeText(passwordField, password);
        click(submitButton);
        return this;
    }

    public String getFlashMessage() {
        return getText(flashAlert);
    }

    public boolean isLogoutButtonVisible() {
        return waitForVisible(logoutButton).isDisplayed();
    }

    public LoginPage logout() {
        click(logoutButton);
        return this;
    }
}
