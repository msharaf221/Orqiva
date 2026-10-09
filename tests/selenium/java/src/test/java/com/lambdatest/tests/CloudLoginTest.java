package com.lambdatest.tests;

import com.lambdatest.pages.LoginPage;
import org.junit.jupiter.api.*;
import org.openqa.selenium.JavascriptExecutor;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.remote.DesiredCapabilities;
import org.openqa.selenium.remote.RemoteWebDriver;

import java.net.URI;
import java.util.HashMap;

public class CloudLoginTest {
    private WebDriver driver;
    private boolean testPassed = false;

    @BeforeEach
    void setUp(TestInfo testInfo) throws Exception {
        String username = System.getenv("LT_USERNAME");
        String accessKey = System.getenv("LT_ACCESS_KEY");
        if (username == null || accessKey == null) {
            throw new IllegalStateException("LT_USERNAME or LT_ACCESS_KEY is not defined in environment!");
        }

        String hubUrl = "https://" + username + ":" + accessKey + "@hub.lambdatest.com/wd/hub";

        DesiredCapabilities caps = new DesiredCapabilities();
        caps.setCapability("browserName", "Chrome");
        caps.setCapability("browserVersion", "latest");

        HashMap<String, Object> ltOptions = new HashMap<>();
        ltOptions.put("platform", "Windows 11");
        ltOptions.put("build", "LambdaTest Selenium Skill Suite (Java)");
        ltOptions.put("name", testInfo.getDisplayName());
        ltOptions.put("video", true);
        ltOptions.put("network", true);
        ltOptions.put("console", true);
        ltOptions.put("w3c", true);
        caps.setCapability("LT:Options", ltOptions);

        driver = new RemoteWebDriver(URI.create(hubUrl).toURL(), caps);
        driver.manage().window().maximize();
    }

    @Test
    @DisplayName("Should successfully login and logout on LambdaTest Cloud Grid")
    void testSuccessfulLoginAndLogout() {
        LoginPage loginPage = new LoginPage(driver).load();
        loginPage.login("tomsmith", "SuperSecretPassword!");

        String bannerText = loginPage.getFlashMessage();
        Assertions.assertTrue(bannerText.contains("You logged into a secure area!"));
        Assertions.assertTrue(loginPage.isLogoutButtonVisible());

        loginPage.logout();
        String logoutBanner = loginPage.getFlashMessage();
        Assertions.assertTrue(logoutBanner.contains("You logged out of the secure area!"));

        testPassed = true;
    }

    @Test
    @DisplayName("Should display error message on invalid credentials")
    void testInvalidLoginShowsError() {
        LoginPage loginPage = new LoginPage(driver).load();
        loginPage.login("invalid_user", "WrongPassword!");

        String bannerText = loginPage.getFlashMessage();
        Assertions.assertTrue(bannerText.contains("Your username is invalid!"));

        testPassed = true;
    }

    @AfterEach
    void tearDown() {
        if (driver != null) {
            try {
                ((JavascriptExecutor) driver).executeScript(
                    "lambda-status=" + (testPassed ? "passed" : "failed")
                );
            } catch (Exception ignored) {
            } finally {
                driver.quit();
            }
        }
    }
}
