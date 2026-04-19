/* ═══════════════════════════════════════════════════════════════
   AZCK Command Centre — Auth Guard  (v2 — working reset flow)
   Include this script at the TOP of every protected page.
   If user is not authenticated, redirects to index.html.

   HOW THE PASSWORD WORKS
   - Default hash is baked in (CC_AUTH.PASSWORD_HASH below).
   - Per-device override lives in localStorage under CC_AUTH.OVERRIDE_KEY.
   - Override wins over baked hash. Cleared by "Reset to default" on
     password.html, or by clearing site data on this browser.
   - ccGetActiveHash() is the single source of truth for what the
     current access code hash is on THIS device.

   TO CHANGE THE DEFAULT FOR EVERYONE
   1. Open the Command Centre in a browser
   2. Run in console:  ccSetPassword('yournewpassword')
   3. Copy the printed hash
   4. Replace PASSWORD_HASH below
   5. Commit auth.js
   ═══════════════════════════════════════════════════════════════ */

// ── CONFIG ──
var CC_AUTH = {
  // Default password: "forge2026"
  PASSWORD_HASH: '455c59944e7fd33667fe9a3b8cc3e91c200174a14065913a06e2013fe2e37bd0',
  SESSION_KEY:   'azck_cc_auth',
  OVERRIDE_KEY:  'azck_cc_pw_override',
  LOGIN_PAGE:    'index.html'
};

// ── Hash function (SHA-256) ──
async function ccHash(str) {
  var encoder = new TextEncoder();
  var data = encoder.encode(str + '_azck_salt_2026');
  var hash = await crypto.subtle.digest('SHA-256', data);
  var arr = Array.from(new Uint8Array(hash));
  return arr.map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

// ── Password helper (run in console to generate hash) ──
window.ccSetPassword = async function(pw) {
  var hash = await ccHash(pw);
  console.log('New PASSWORD_HASH: ' + hash);
  console.log('Update this value in auth.js CC_AUTH.PASSWORD_HASH to change the default for everyone.');
  return hash;
};

// ── Active hash (override wins over baked) ──
function ccGetActiveHash() {
  try {
    var o = localStorage.getItem(CC_AUTH.OVERRIDE_KEY);
    if (o && /^[a-f0-9]{64}$/i.test(o)) return o;
  } catch(e) {}
  return CC_AUTH.PASSWORD_HASH;
}

// ── Is the current device using a custom code? ──
function ccHasOverride() {
  try {
    var o = localStorage.getItem(CC_AUTH.OVERRIDE_KEY);
    return !!(o && /^[a-f0-9]{64}$/i.test(o));
  } catch(e) { return false; }
}

// ── Save a new access code (per-device) ──
async function ccSaveNewPassword(newPw) {
  var hash = await ccHash(newPw);
  try {
    localStorage.setItem(CC_AUTH.OVERRIDE_KEY, hash);
    sessionStorage.setItem(CC_AUTH.SESSION_KEY, hash);
    return true;
  } catch(e) { return false; }
}

// ── Clear override, restore default code ──
function ccClearOverride() {
  try { localStorage.removeItem(CC_AUTH.OVERRIDE_KEY); } catch(e) {}
  try { sessionStorage.removeItem(CC_AUTH.SESSION_KEY); } catch(e) {}
}

// ── Verify login (uses active hash: override or default) ──
async function ccVerifyPassword(pw) {
  var hash = await ccHash(pw);
  if (hash === ccGetActiveHash()) {
    sessionStorage.setItem(CC_AUTH.SESSION_KEY, hash);
    return true;
  }
  return false;
}

// ── Check if authenticated ──
function ccIsAuthenticated() {
  return sessionStorage.getItem(CC_AUTH.SESSION_KEY) === ccGetActiveHash();
}

// ── Logout ──
function ccLogout() {
  sessionStorage.removeItem(CC_AUTH.SESSION_KEY);
  window.location.href = CC_AUTH.LOGIN_PAGE;
}

// ── Auth guard — redirect if not on login page and not authenticated ──
(function() {
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  // password.html handles its own auth (requires current code inside the form)
  if (currentPage !== 'index.html' && currentPage !== '' && currentPage !== 'password.html') {
    if (!ccIsAuthenticated()) {
      sessionStorage.setItem('azck_cc_redirect', window.location.href);
      window.location.href = CC_AUTH.LOGIN_PAGE;
    }
  }
})();
