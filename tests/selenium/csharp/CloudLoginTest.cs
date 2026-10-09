using System;
using System.Collections.Generic;
using NUnit.Framework;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;
using OpenQA.Selenium.Remote;
using LambdaTest.Selenium.Pages;

namespace LambdaTest.Selenium.Tests
{
    [TestFixture]
    public class CloudLoginTest
    {
        private IWebDriver? _driver;
        private bool _testPassed;

        [SetUp]
        public void SetUp()
        {
            _testPassed = false;
            var username = Environment.GetEnvironmentVariable("LT_USERNAME");
            var accessKey = Environment.GetEnvironmentVariable("LT_ACCESS_KEY");

            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(accessKey))
            {
                Assert.Fail("LT_USERNAME and LT_ACCESS_KEY environment variables are required.");
            }

            var hubUrl = new Uri($"https://{username}:{accessKey}@hub.lambdatest.com/wd/hub");
            var options = new ChromeOptions
            {
                BrowserVersion = "latest",
                PlatformName = "Windows 11"
            };

            var ltOptions = new Dictionary<string, object>
            {
                { "username", username! },
                { "accessKey", accessKey! },
                { "build", "LambdaTest Selenium Skill Suite (C#)" },
                { "name", TestContext.CurrentContext.Test.Name },
                { "video", true },
                { "network", true },
                { "console", true },
                { "w3c", true },
                { "plugin", "c#-nunit" }
            };

            options.AddAdditionalOption("LT:Options", ltOptions);

            _driver = new RemoteWebDriver(hubUrl, options.ToCapabilities(), TimeSpan.FromSeconds(60));
            _driver.Manage().Window.Maximize();
        }

        [Test]
        public void TestSuccessfulLoginAndLogout()
        {
            var loginPage = new LoginPage(_driver!).Load();
            loginPage.Login("tomsmith", "SuperSecretPassword!");

            var banner = loginPage.GetFlashMessage();
            Assert.That(banner, Does.Contain("You logged into a secure area!"));
            Assert.That(loginPage.IsLogoutButtonVisible(), Is.True);

            loginPage.Logout();
            var logoutBanner = loginPage.GetFlashMessage();
            Assert.That(logoutBanner, Does.Contain("You logged out of the secure area!"));

            _testPassed = true;
        }

        [TearDown]
        public void TearDown()
        {
            if (_driver != null)
            {
                try
                {
                    ((IJavaScriptExecutor)_driver).ExecuteScript(
                        $"lambda-status={(_testPassed ? "passed" : "failed")}"
                    );
                }
                catch
                {
                    // Ignore status reporting errors on teardown
                }
                finally
                {
                    _driver.Quit();
                }
            }
        }
    }
}
