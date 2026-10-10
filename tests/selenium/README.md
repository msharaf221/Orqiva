# 🧪 Selenium Cloud Automation Suite (LambdaTest / TestMu AI)

This automation suite was generated adhering to the **`selenium-skill`** standard rules and best practices. It supports executing enterprise-grade tests locally and on the **LambdaTest / TestMu AI cloud grid** across 3000+ real browser and operating system combinations.

---

## 📋 Architectural Principles (`selenium-skill`)

1. **Strict Locator Priority**:
   - `By.ID` (fastest & most stable)
   - `By.NAME` (form controls)
   - `By.CSS_SELECTOR` (clean & expressive)
   - `By.XPATH` (strictly relative, zero fragile or absolute paths)

2. **Wait Strategy**:
   - **100% Explicit Waits** (`WebDriverWait` / `until`)
   - **Zero `Thread.sleep()` / `time.sleep()`** to eliminate flakiness and optimize execution time.
   - No mixing of implicit and explicit timeouts.

3. **Page Object Model (POM)**:
   - Locators, actions, and page-level wait abstractions are fully encapsulated in page classes (`BasePage`, `LoginPage`, `PlaygroundPage`).
   - Assertions remain strictly inside test methods.

4. **Cloud Observability & Teardown**:
   - Authentication via `LT_USERNAME` and `LT_ACCESS_KEY` environment variables.
   - W3C-compliant `LT:Options` configuring video recording, network logs, and console logs.
   - Automated status synchronization to the LambdaTest dashboard via `driver.execute_script("lambda-status=passed/failed")`.
   - Guaranteed resource cleanup (`driver.quit()`) in test lifecycle teardown hooks.

---

## 🚀 Quick Start (Python)

### 1. Environment Setup
The suite uses Python with `selenium` and `pytest`:
```bash
# If not already configured:
python3 -m venv .venv-selenium
source .venv-selenium/bin/activate
pip install selenium pytest
```

### 2. Set Cloud Credentials
Ensure your LambdaTest credentials are set in the environment:
```bash
export LT_USERNAME="<your_lambdatest_username>"
export LT_ACCESS_KEY="<your_lambdatest_access_key>"
```

### 3. Run Tests on LambdaTest Cloud Grid
```bash
# Run all cloud tests
.venv-selenium/bin/pytest tests/selenium/python/ -v

# Run authentication cloud tests specifically
.venv-selenium/bin/pytest tests/selenium/python/test_cloud_login.py -v

# Run interactive form / playground tests
.venv-selenium/bin/pytest tests/selenium/python/test_cloud_playground.py -v

# Run on custom browser & platform (e.g. Firefox on macOS)
.venv-selenium/bin/pytest tests/selenium/python/ --browser-name=firefox --platform-name="macOS Sonoma" -v
```

---

## ☕ Java (Maven + JUnit 5)

Located in `tests/selenium/java/`:
```bash
cd tests/selenium/java
mvn test
# Run specific test
mvn test -Dtest=CloudLoginTest
```

---

## 🟨 JavaScript / Node.js

Located in `tests/selenium/javascript/`:
```bash
node tests/selenium/javascript/test_cloud_login.js
```

---

## 🔷 C# (.NET + NUnit)

Located in `tests/selenium/csharp/`:
```bash
cd tests/selenium/csharp
dotnet test
```
