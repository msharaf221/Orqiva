import os
import pytest
from typing import Generator
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.client_config import ClientConfig

def _load_env_if_missing():
    """Attempt reading .env in project root if variables are not in os.environ."""
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    if os.path.exists(env_file):
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("\"'")
                    if key not in os.environ:
                        os.environ[key] = val

_load_env_if_missing()

@pytest.fixture(scope="session")
def lt_credentials():
    username = os.environ.get("LT_USERNAME")
    access_key = os.environ.get("LT_ACCESS_KEY")
    if not username or not access_key:
        pytest.fail(
            "Missing LambdaTest credentials! Please set LT_USERNAME and LT_ACCESS_KEY environment variables."
        )
    return {"username": username, "access_key": access_key}

def pytest_addoption(parser):
    parser.addoption(
        "--browser-name",
        action="store",
        default="chrome",
        help="Browser to run on LambdaTest cloud grid: chrome, firefox, edge"
    )
    parser.addoption(
        "--platform-name",
        action="store",
        default="Windows 11",
        help="Operating system platform on LambdaTest cloud grid: 'Windows 11', 'macOS Sonoma', 'Windows 10'"
    )

@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    setattr(item, "rep_" + rep.when, rep)

@pytest.fixture
def driver(request, lt_credentials) -> Generator[WebDriver, None, None]:
    """
    Creates a RemoteWebDriver session connected to the LambdaTest / TestMu AI cloud grid.
    Includes automated status reporting (lambda-status=passed/failed) and guaranteed teardown.
    """
    username = lt_credentials["username"]
    access_key = lt_credentials["access_key"]
    browser = request.config.getoption("--browser-name").lower()
    platform = request.config.getoption("--platform-name")
    test_name = request.node.name

    # Determine browser options
    if browser == "firefox":
        options = FirefoxOptions()
        browser_name = "Firefox"
    elif browser == "edge":
        options = EdgeOptions()
        browser_name = "MicrosoftEdge"
    else:
        options = ChromeOptions()
        browser_name = "Chrome"

    options.browser_version = "latest"
    options.platform_name = platform

    # W3C Compliant LambdaTest Options
    lt_options = {
        "username": username,
        "accessKey": access_key,
        "build": "LambdaTest Selenium Skill Suite",
        "project": "Cloud Automation & Quality Engineering",
        "name": test_name,
        "w3c": True,
        "video": True,
        "network": True,
        "console": True,
        "visual": True,
        "platformName": platform,
        "plugin": "python-pytest",
    }
    options.set_capability("LT:Options", lt_options)

    # Use ClientConfig for clean authentication without plaintext user:pass in URL
    client_config = ClientConfig(
        remote_server_addr="https://hub.lambdatest.com/wd/hub",
        username=username,
        password=access_key,
    )

    remote_driver = webdriver.Remote(
        command_executor="https://hub.lambdatest.com/wd/hub",
        client_config=client_config,
        options=options,
    )

    try:
        remote_driver.maximize_window()
    except Exception:
        pass

    yield remote_driver

    # Teardown: Report test status back to LambdaTest dashboard
    try:
        call_report = getattr(request.node, "rep_call", None)
        if call_report and call_report.passed:
            remote_driver.execute_script("lambda-status=passed")
        else:
            remote_driver.execute_script("lambda-status=failed")
    except Exception:
        pass
    finally:
        remote_driver.quit()
