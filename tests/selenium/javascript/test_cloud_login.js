import { Builder } from "selenium-webdriver";
import { LoginPage } from "./pages/LoginPage.js";
import assert from "node:assert/strict";

async function runLambdaTestLoginSuite() {
  const username = process.env.LT_USERNAME;
  const accessKey = process.env.LT_ACCESS_KEY;

  if (!username || !accessKey) {
    throw new Error("Missing LT_USERNAME or LT_ACCESS_KEY environment variables!");
  }

  const gridUrl = `https://${username}:${accessKey}@hub.lambdatest.com/wd/hub`;

  const capabilities = {
    browserName: "Chrome",
    browserVersion: "latest",
    "LT:Options": {
      platform: "Windows 11",
      build: "LambdaTest Selenium Skill Suite (JS)",
      name: "JavaScript Authentication Cloud Suite",
      user: username,
      accessKey: accessKey,
      video: true,
      network: true,
      console: true,
      w3c: true,
      plugin: "node-js",
    },
  };

  console.log("Connecting to LambdaTest / TestMu AI cloud grid via Node.js Selenium WebDriver...");
  const driver = await new Builder()
    .usingServer(gridUrl)
    .withCapabilities(capabilities)
    .build();

  let testPassed = false;
  try {
    const loginPage = new LoginPage(driver);

    // Test 1: Successful login
    console.log("Running Test 1: Successful login...");
    await loginPage.load();
    await loginPage.login("tomsmith", "SuperSecretPassword!");
    const flashMessage = await loginPage.getFlashMessage();
    assert(
      flashMessage.includes("You logged into a secure area!"),
      `Expected secure area banner, received: ${flashMessage}`
    );

    // Test 2: Successful logout
    console.log("Running Test 2: Successful logout...");
    await loginPage.logout();
    const logoutFlash = await loginPage.getFlashMessage();
    assert(
      logoutFlash.includes("You logged out of the secure area!"),
      `Expected logout confirmation, received: ${logoutFlash}`
    );

    console.log("All JavaScript tests passed on LambdaTest cloud grid!");
    testPassed = true;
  } catch (error) {
    console.error("Test execution failed:", error);
    testPassed = false;
    throw error;
  } finally {
    try {
      await driver.executeScript(`lambda-status=${testPassed ? "passed" : "failed"}`);
    } catch (_) {}
    await driver.quit();
  }
}

// Execute if run directly
if (process.argv[1].endsWith("test_cloud_login.js")) {
  runLambdaTestLoginSuite().catch(() => process.exit(1));
}

export { runLambdaTestLoginSuite };
