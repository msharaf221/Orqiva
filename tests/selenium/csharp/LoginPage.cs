using OpenQA.Selenium;

namespace LambdaTest.Selenium.Pages
{
    public class LoginPage : BasePage
    {
        public const string PageUrl = "https://the-internet.herokuapp.com/login";

        // Locators (Priority: ID > NAME > CSS)
        private static readonly By UsernameInput = By.Id("username");
        private static readonly By PasswordInput = By.Id("password");
        private static readonly By SubmitButton = By.CssSelector("button[type='submit']");
        private static readonly By FlashAlert = By.Id("flash");
        private static readonly By LogoutButton = By.CssSelector("a[href='/logout']");

        public LoginPage(IWebDriver driver) : base(driver) { }

        public LoginPage Load()
        {
            Open(PageUrl);
            return this;
        }

        public LoginPage Login(string username, string password)
        {
            TypeText(UsernameInput, username);
            TypeText(PasswordInput, password);
            Click(SubmitButton);
            return this;
        }

        public string GetFlashMessage() => GetText(FlashAlert);

        public bool IsLogoutButtonVisible() => WaitForVisible(LogoutButton).Displayed;

        public LoginPage Logout()
        {
            Click(LogoutButton);
            return this;
        }
    }
}
