-- The installed license key (one row). The key is a signed token, so storing it is safe.
CREATE TABLE license (
  id INTEGER PRIMARY KEY CHECK(id=1),
  key TEXT NOT NULL,
  installed_at TEXT NOT NULL
);
