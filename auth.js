/* ═══════════════════════════════════════════════════════════════
   AZCK Command Centre — Auth Guard
   Include this script at the TOP of every protected page.
   If user is not authenticated, redirects to index.html.

   To change the password:
   1. Open browser console on any page
   2. Run: ccSetPassword('yournewpassword')
   3. Copy the hash it prints
   4. Replace PASSWORD_HASH below
   ═══════════════════════════════════════════════════════════════ */

// ── CONFIG — UPDATE PASSWORD HASH HERE ──
var CC_AUTH = {
  // Default password: "forge2026"
  // To generate a new hash, run ccSetPassword('newpassword') in browser console
  PASSWORD_HASH: '455c59944e7fd33667fe9a3b8cc3e91c200174a14065913a06e2013fe2e37bd0',
  SESSION_KEY: 'azck_cc_auth',
  LOGIN_PAGE: 'index.html'
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
  console.log('Update this value in auth.js CC_AUTH.PASSWORD_HASH');
  return hash;
};

// ── Verify login ──
async function ccVerifyPassword(pw) {
  var hash = await ccHash(pw);
  if (hash === CC_AUTH.PASSWORD_HASH) {
    sessionStorage.setItem(CC_AUTH.SESSION_KEY, hash);
    return true;
  }
  return false;
}

// ── Check if authenticated ──
function ccIsAuthenticated() {
  return sessionStorage.getItem(CC_AUTH.SESSION_KEY) === CC_AUTH.PASSWORD_HASH;
}

// ── Logout ──
function ccLogout() {
  sessionStorage.removeItem(CC_AUTH.SESSION_KEY);
  window.location.href = CC_AUTH.LOGIN_PAGE;
}

// ── Auth guard — redirect if not on login page and not authenticated ──
(function() {
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  if (currentPage !== 'index.html' && currentPage !== '') {
    if (!ccIsAuthenticated()) {
      // Save intended destination
      sessionStorage.setItem('azck_cc_redirect', window.location.href);
      window.location.href = CC_AUTH.LOGIN_PAGE;
    }
  }
})();
