using System;
using OpenQA.Selenium;
using OpenQA.Selenium.Support.UI;
using SeleniumExtras.WaitHelpers;

namespace LambdaTest.Selenium.Pages
{
    public abstract class BasePage
    {
        protected readonly IWebDriver Driver;
        protected readonly WebDriverWait Wait;

        protected BasePage(IWebDriver driver, TimeSpan? timeout = null)
        {
            Driver = driver;
            Wait = new WebDriverWait(driver, timeout ?? TimeSpan.FromSeconds(15));
        }

        public void Open(string url) => Driver.Navigate().GoToUrl(url);

        public IWebElement WaitForVisible(By locator) => Wait.Until(ExpectedConditions.ElementIsVisible(locator));

        public IWebElement WaitForClickable(By locator) => Wait.Until(ExpectedConditions.ElementToBeClickable(locator));

        public void Click(By locator)
        {
            var element = WaitForClickable(locator);
            try
            {
                element.Click();
            }
            catch (Exception)
            {
                ((IJavaScriptExecutor)Driver).ExecuteScript("arguments[0].scrollIntoView({block: 'center'});", element);
                try
                {
                    element.Click();
                }
                catch (Exception)
                {
                    ((IJavaScriptExecutor)Driver).ExecuteScript("arguments[0].click();", element);
                }
            }
        }

        public void TypeText(By locator, string text, bool clearFirst = true)
        {
            var element = WaitForVisible(locator);
            if (clearFirst) element.Clear();
            element.SendKeys(text);
        }

        public string GetText(By locator) => WaitForVisible(locator).Text.Trim();
    }
}
