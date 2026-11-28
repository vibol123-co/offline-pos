# 2. Authentication and sessions

Sign-in has two layers.

1. **Shop Google account (always on).** The browser gets an OAuth access token through Google Identity Services. On every call, the API checks that the caller's email matches the `BOOTSTRAP_ADMIN_EMAIL` Script Property (`requireShopGoogleAccount_`).
2. **POS staff login.** The staff member enters a username and password, which are checked against the `StaffAccess` tab. The server returns a random session token. It is stored in the script cache under its SHA-256 hash and lasts 6 hours.

```mermaid
sequenceDiagram
    autonumber
    actor U as Staff member
    participant C as POS page (Client.html)
    participant G as Google Identity Services
    participant X as Execution API
    participant A as AccessService.gs
    participant K as Script cache
    participant S as StaffAccess sheet

    U->>C: Click "Connect Google account"
    C->>G: initTokenClient + requestAccessToken (select_account)
    G-->>C: access_token (about 1 hour)
    C->>X: getAuthConfig({sections})
    X->>A: getAuthConfig
    A->>A: requireShopGoogleAccount_()<br/>caller email == BOOTSTRAP_ADMIN_EMAIL?
    alt STAFF_LOGIN_ENABLED = false (test switch)
        A-->>C: staffLoginEnabled=false + startup data
        C->>C: enterApp_() as built-in "shop" admin
    else Normal
        A-->>C: staffLoginEnabled=true
        C->>U: Show username/password form
        U->>C: Submit username + password
        C->>X: loginStaff(username, password, {sections})
        X->>A: loginStaff
        A->>S: read StaffAccess (fresh, cache skipped)
        A->>A: user exists, active, password matches?
        A->>K: put hash(token) → {staff_id, session_version}, TTL 6h
        A-->>C: sessionToken + startup data for the landing page
        C->>C: enterApp_() → show allowed pages, flush offline queue
    end
```

## Check on every protected call

```mermaid
flowchart LR
    R["API call with sessionToken"] --> G1{"Caller is shop<br/>Google account?"}
    G1 -- no --> E1["Error: Connect using the<br/>configured shop Google account"]
    G1 -- yes --> G2{"Session in cache?"}
    G2 -- no --> E2["Error: session expired, sign in again"]
    G2 -- yes --> G3{"Staff active and<br/>session_version matches?"}
    G3 -- no --> E3["Error: account changed or disabled"]
    G3 -- yes --> G4{"Admin, or page in<br/>allowed_pages?"}
    G4 -- no --> E4["Error: no access to this page"]
    G4 -- yes --> OK["Run the business function"]
```

## How a session ends

| Event | Effect |
|-------|--------|
| 6 hours pass, or the cache evicts the entry | The next call fails with "session expired" |
| Admin changes the user's password or enables/disables the account | `session_version` goes up, so every open session for that user is rejected |
| User clicks **Switch user** | `logoutStaff` removes the cache entry, and the page returns to the login form |
| User clicks **Change Google account** | The OAuth token is revoked in the browser, and both layers have to be done again |

> Security note from `docs/ARCHITECTURE.md`: this login identifies which staff member did what. It does not keep staff securely apart. POS passwords are stored in plain text in `StaffAccess`, and the shop's OAuth token is present in the browser.
