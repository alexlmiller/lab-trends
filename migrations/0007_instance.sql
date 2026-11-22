-- Who may use this deployment.
--
-- instance: the Cloudflare Access application this deployment trusts and its owner,
-- recorded at the first sign-in. One row. Deleting it lets the next sign-in claim the
-- deployment again (docs/operating.md: "Sign-in problems").
CREATE TABLE instance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_team_domain TEXT NOT NULL,                -- <team>.cloudflareaccess.com
  access_aud TEXT NOT NULL,                        -- audience tag of the Access application
  owner_email TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

-- People the owner has let in, besides the owner.
CREATE TABLE allowed_users (
  email TEXT PRIMARY KEY,                          -- lowercase
  added_at TEXT NOT NULL,
  added_by TEXT
);
