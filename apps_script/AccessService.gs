const ALL_PAGE_KEYS_ = [
  "dashboard",
  "new-order",
  "orders",
  "products",
  "suppliers",
  "stock",
  "reports",
  "settings"
];
const STAFF_SESSION_TTL_SECONDS_ = 21600;

function normalizeEmail_(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername_(username) {
  return String(username || "").trim().toLowerCase();
}

function requireShopGoogleAccount_() {
  const expectedEmail = normalizeEmail_(
    PropertiesService.getScriptProperties().getProperty("BOOTSTRAP_ADMIN_EMAIL")
  );
  const callerEmail = normalizeEmail_(Session.getActiveUser().getEmail());
  if (!expectedEmail || !callerEmail || callerEmail !== expectedEmail) {
    throw new Error("Connect using the configured shop Google account.");
  }
}

// Temporary switch for testing. Set Script Property STAFF_LOGIN_ENABLED = false to skip the
// POS username/password layer; delete it (or set it to true) to turn staff sign-in back on.
// The shop Google account check (layer 1) always stays on.
const STAFF_LOGIN_DISABLED_USER_ = Object.freeze({
  id: "staff-login-disabled",
  username: "shop",
  display_name: "Shop account (staff sign-in off)",
  role: "admin"
});

function isStaffLoginEnabled_() {
  const value = PropertiesService.getScriptProperties().getProperty("STAFF_LOGIN_ENABLED");
  return String(value || "").trim().toLowerCase() !== "false";
}

// options.sections: when staff sign-in is off, the startup data comes back in the same call.
// options.warm: staff sign-in is on and the user is typing: prepare the page data meanwhile.
function getAuthConfig(options) {
  requireShopGoogleAccount_();
  const enabled = isStaffLoginEnabled_();
  const result = { staffLoginEnabled: enabled };
  if (!enabled && options && Array.isArray(options.sections)) {
    result.startup = safeStartup_(getCurrentStaff_(""), options);
  } else if (enabled && options && options.warm) {
    try {
      ensureSchema_();
      warmSections_(options);
    } catch (error) {
      console.warn("Warm-up skipped: " + error.message);
    }
  }
  return result;
}

// Startup data is a bonus on sign-in: if it fails, sign-in still succeeds and the website
// loads the data with a normal call instead.
function safeStartup_(staff, options) {
  try {
    ensureSchema_();
    return buildSections_(staff, options.sections, options);
  } catch (error) {
    return { error: String(error.message || error) };
  }
}

// options.sections: the sections for the landing page, returned with the session in one call.
function loginStaff(username, password, options) {
  requireShopGoogleAccount_();
  ensureSchema_();
  const normalizedUsername = normalizeUsername_(username);
  const passwordText = typeof password === "string" ? password : "";
  const findStaff = function() {
    return readTable_("StaffAccess").find(function(record) {
      return normalizeUsername_(record.username) === normalizedUsername;
    });
  };
  // Cached copy first (fast). If it does not match, read the sheet itself, so a username or
  // password typed straight into the sheet works immediately.
  let staff = findStaff();
  if (!staff || !isEnabled_(staff.active) || String(staff.password || "") !== passwordText) {
    forgetSharedTable_("StaffAccess");
    delete tableMemo_.StaffAccess;
    staff = findStaff();
  }
  if (!staff || !isEnabled_(staff.active)) {
    throw new Error("Username or password is incorrect.");
  }
  if (!String(staff.password || "")) {
    throw new Error("No password is set for this POS user. Ask an administrator.");
  }
  if (String(staff.password) !== passwordText) {
    throw new Error("Username or password is incorrect.");
  }

  const sessionToken = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put(
    staffSessionCacheKey_(sessionToken),
    JSON.stringify({
      staff_id: staff.id,
      session_version: Number(staff.session_version || 0)
    }),
    STAFF_SESSION_TTL_SECONDS_
  );
  const result = { sessionToken: sessionToken };
  if (options && Array.isArray(options.sections)) {
    result.startup = safeStartup_(staffProfile_(staff), options);
  }
  return result;
}

function logoutStaff(sessionToken) {
  if (typeof sessionToken === "string" && sessionToken) {
    CacheService.getScriptCache().remove(staffSessionCacheKey_(sessionToken));
  }
  return true;
}

function getCurrentStaff_(sessionToken) {
  requireShopGoogleAccount_();
  if (!isStaffLoginEnabled_()) {
    return {
      id: STAFF_LOGIN_DISABLED_USER_.id,
      username: STAFF_LOGIN_DISABLED_USER_.username,
      display_name: STAFF_LOGIN_DISABLED_USER_.display_name,
      role: STAFF_LOGIN_DISABLED_USER_.role,
      allowed_pages: ALL_PAGE_KEYS_.slice()
    };
  }
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error("Sign in to Bakery POS and try again.");
  }
  const serializedSession = CacheService.getScriptCache().get(staffSessionCacheKey_(sessionToken));
  if (!serializedSession) {
    throw new Error("Your POS session expired. Sign in again.");
  }
  let session;
  try {
    session = JSON.parse(serializedSession);
  } catch (error) {
    throw new Error("Your POS session is invalid. Sign in again.");
  }
  const staff = findById_("StaffAccess", session.staff_id);
  if (!staff || !isEnabled_(staff.active) ||
      Number(staff.session_version || 0) !== Number(session.session_version || 0)) {
    throw new Error("Your POS account changed or was disabled. Sign in again.");
  }
  return staffProfile_(staff);
}

function staffProfile_(staff) {
  let allowedPages;
  try {
    allowedPages = JSON.parse(staff.allowed_pages_json || "[]");
  } catch (error) {
    throw new Error("Your page access settings are invalid. Ask an administrator.");
  }
  if (!Array.isArray(allowedPages)) {
    throw new Error("Your page access settings are invalid. Ask an administrator.");
  }
  const isAdmin = staff.role === "admin";
  return {
    id: String(staff.id),
    username: normalizeUsername_(staff.username),
    display_name: String(staff.display_name || staff.username || ""),
    role: isAdmin ? "admin" : "cashier",
    allowed_pages: isAdmin
      ? ALL_PAGE_KEYS_.slice()
      : allowedPages.filter(function(page) {
        return ALL_PAGE_KEYS_.indexOf(page) !== -1 && page !== "settings";
      })
  };
}

function requirePageAccess_(sessionToken, pageKey) {
  const staff = getCurrentStaff_(sessionToken);
  if (staff.role === "admin" || staff.allowed_pages.indexOf(pageKey) !== -1) {
    return staff;
  }
  throw new Error("You do not have access to this page.");
}

function requireAdmin_(sessionToken) {
  const staff = getCurrentStaff_(sessionToken);
  if (staff.role !== "admin") {
    throw new Error("Only an administrator can manage staff access.");
  }
  return staff;
}

function listStaffAccess(sessionToken) {
  requireAdmin_(sessionToken);
  return listStaffAccessRecords_();
}

function listStaffAccessRecords_() {
  return readTable_("StaffAccess").map(function(record) {
    let pages = [];
    try {
      pages = JSON.parse(record.allowed_pages_json || "[]");
    } catch (error) {
      pages = [];
    }
    return {
      id: String(record.id),
      username: normalizeUsername_(record.username),
      display_name: String(record.display_name || ""),
      password: String(record.password || ""),
      role: record.role === "admin" ? "admin" : "cashier",
      allowed_pages: record.role === "admin" ? ALL_PAGE_KEYS_.slice() : pages,
      active: isEnabled_(record.active)
    };
  });
}

function updateStaffAccess(payload, requestId, sessionToken) {
  const actor = requireAdmin_(sessionToken);
  return runIdempotent_(requestId, "updateStaffAccess", function() {
    forgetSharedTable_("StaffAccess");
    delete tableMemo_.StaffAccess;
    const records = readTable_("StaffAccess");
    const existing = payload.id
      ? records.find(function(record) { return String(record.id) === String(payload.id); })
      : null;
    if (payload.id && !existing) {
      throw new Error("The selected staff account no longer exists.");
    }

    const username = normalizeUsername_(requiredText_(payload.username, "username", 40));
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      throw new Error("Username must be 3–40 characters using letters, numbers, dots, dashes, or underscores.");
    }
    if (records.some(function(record) {
      return String(record.id) !== String(existing ? existing.id : "") &&
        normalizeUsername_(record.username) === username;
    })) {
      throw new Error("That username is already in use.");
    }
    const displayName = requiredText_(payload.display_name, "staff name", 120);
    const role = choice_(payload.role, ["admin", "cashier"], "role");
    const active = payload.active !== false;
    let password = existing ? String(existing.password || "") : "";
    let passwordChanged = false;
    if (payload.password !== undefined && payload.password !== null && payload.password !== "") {
      if (typeof payload.password !== "string" || payload.password.length < 4 ||
          payload.password.length > 128) {
        throw new Error("Password must be between 4 and 128 characters.");
      }
      passwordChanged = payload.password !== password;
      password = payload.password;
    }
    if (!password) {
      throw new Error("Set a password for this staff account.");
    }

    if (String(existing && existing.id) === actor.id && (role !== "admin" || !active)) {
      throw new Error("You cannot remove your own active administrator access.");
    }
    let allowedPages = payload.allowed_pages;
    if (!Array.isArray(allowedPages)) {
      throw new Error("Select at least one page.");
    }
    allowedPages = Array.from(new Set(allowedPages.map(String)));
    if (allowedPages.some(function(page) { return ALL_PAGE_KEYS_.indexOf(page) === -1; })) {
      throw new Error("The page access list contains an invalid page.");
    }
    if (role === "admin") {
      allowedPages = ALL_PAGE_KEYS_.slice();
    } else {
      allowedPages = allowedPages.filter(function(page) { return page !== "settings"; });
      if (!allowedPages.length) {
        throw new Error("Select at least one page for the cashier.");
      }
    }

    const adminsAfterUpdate = records.filter(function(record) {
      const isTarget = existing && String(record.id) === String(existing.id);
      const effectiveRole = isTarget ? role : record.role;
      const effectiveActive = isTarget ? active : isEnabled_(record.active);
      return effectiveRole === "admin" && effectiveActive;
    }).length;
    if (adminsAfterUpdate < 1) {
      throw new Error("At least one active administrator must remain.");
    }

    const now = nowIso_();
    const id = existing ? String(existing.id) : makeId_();
    const activeChanged = existing && isEnabled_(existing.active) !== active;
    upsertRows_("StaffAccess", [{
      id: id,
      email: existing ? existing.email : "",
      role: role,
      allowed_pages_json: JSON.stringify(allowedPages),
      active: active,
      created_at: existing ? existing.created_at : now,
      updated_at: now,
      username: username,
      password: password,
      display_name: displayName,
      session_version: Number(existing && existing.session_version || 0) +
        (passwordChanged || activeChanged ? 1 : 0)
    }]);
    return {
      id: id,
      username: username,
      display_name: displayName,
      role: role,
      active: active,
      session_invalidated: id === actor.id && passwordChanged
    };
  }, actor);
}

function staffSessionCacheKey_(sessionToken) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    sessionToken,
    Utilities.Charset.UTF_8
  );
  const key = digest.map(function(byte) {
    return ("0" + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join("");
  return "staff_session_" + key;
}

function isEnabled_(value) {
  return value === true || String(value).toLowerCase() === "true";
}
