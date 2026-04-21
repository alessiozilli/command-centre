/* AZCK Command Centre â€” auth.js v4
 * Pass 1 rebuild (2026-04-21). Client-side casual lock + device identity.
 * Migrates to Supabase Auth in Pass 5.
 *
 * What's new vs v3:
 *  - Remember-me: localStorage when checked, sessionStorage-only when not
 *  - Device identity: azck_device_id, azck_device_label, first/last seen
 *  - ccTouchDevice() fires on every authenticated page hit
 *  - ccGetDeviceInfo() / ccSetDeviceLabel(label)
 *  - ccSaveNewPassword / ccClearOverride now re-write any active session hash
 *  - Guard preserves attempted URL in sessionStorage.azck_cc_redirect
 */
(function () {
  'use strict';

  // ---- Config ----------------------------------------------------------
  // Default password hash (SHA-256). Rotate by running ccSetPassword('newpw')
  // in the browser console on any CC page, then pasting the printed hash here.
  const CC_AUTH = {
    PASSWORD_HASH: '455c59944e7fd33667fe9a3b8cc3e91c200174a14065913a06e2013fe2e37bd0',
    SESSION_KEY:   'azck_cc_auth',
    OVERRIDE_KEY:  'azck_cc_pw_override',
    REDIRECT_KEY:  'azck_cc_redirect',
    DEVICE_ID:     'azck_device_id',
    DEVICE_LABEL:  'azck_device_label',
    DEVICE_FIRST:  'azck_device_first_seen',
    DEVICE_LAST:   'azck_device_last_seen',
    LOGIN_PAGE:    'index.html',
    HOME_PAGE:     'dashboard.html',
    SALT:          '_azck_salt_2026'
  };

  // ---- Hashing ---------------------------------------------------------
  // CRITICAL: must match v3's ccHash exactly â€” same salt, same encoding,
  // same hex output. PASSWORD_HASH on disk was produced by v3 for Alessio's
  // code; if we change this algorithm, existing hash no longer matches.
  async function sha256(str) {
    const buf = new TextEncoder().encode(str + CC_AUTH.SALT);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- Password override (per-device custom code) ---------------------
  function getActiveHash() {
    return localStorage.getItem(CC_AUTH.OVERRIDE_KEY) || CC_AUTH.PASSWORD_HASH;
  }

  async function ccSaveNewPassword(pw) {
    if (!pw || pw.length < 3) throw new Error('Password too short');
    const newHash = await sha256(pw);
    localStorage.setItem(CC_AUTH.OVERRIDE_KEY, newHash);
    // If a session is active, re-sign it so the user stays logged in.
    const activeStore = _activeSessionStore();
    if (activeStore) activeStore.setItem(CC_AUTH.SESSION_KEY, newHash);
    return true;
  }

  function ccClearOverride() {
    localStorage.removeItem(CC_AUTH.OVERRIDE_KEY);
    // Re-sign active session to the baked-in default so user stays logged in.
    const activeStore = _activeSessionStore();
    if (activeStore) activeStore.setItem(CC_AUTH.SESSION_KEY, CC_AUTH.PASSWORD_HASH);
    return true;
  }

  async function ccSetPassword(pw) {
    const h = await sha256(pw);
    console.log('SHA-256:', h);
    console.log('Paste into CC_AUTH.PASSWORD_HASH in auth.js and commit.');
    return h;
  }

  // ---- Session helpers ------------------------------------------------
  function _activeSessionStore() {
    if (localStorage.getItem(CC_AUTH.SESSION_KEY)) return localStorage;
    if (sessionStorage.getItem(CC_AUTH.SESSION_KEY)) return sessionStorage;
    return null;
  }

  function ccIsAuthenticated() {
    const want = getActiveHash();
    const ls = localStorage.getItem(CC_AUTH.SESSION_KEY);
    const ss = sessionStorage.getItem(CC_AUTH.SESSION_KEY);
    return ls === want || ss === want;
  }

  async function ccLogin(pw, rememberMe) {
    const got = await sha256(pw);
    const want = getActiveHash();
    if (got !== want) return false;
    if (rememberMe) {
      localStorage.setItem(CC_AUTH.SESSION_KEY, want);
      sessionStorage.removeItem(CC_AUTH.SESSION_KEY);
    } else {
      sessionStorage.setItem(CC_AUTH.SESSION_KEY, want);
      localStorage.removeItem(CC_AUTH.SESSION_KEY);
    }
    ccTouchDevice();
    return true;
  }

  function ccLogout() {
    localStorage.removeItem(CC_AUTH.SESSION_KEY);
    sessionStorage.removeItem(CC_AUTH.SESSION_KEY);
    window.location.href = CC_AUTH.LOGIN_PAGE;
  }

  // ---- Device identity ------------------------------------------------
  function _randHex(n) {
    const bytes = new Uint8Array(n / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function ccTouchDevice() {
    if (!ccIsAuthenticated()) return;
    if (!localStorage.getItem(CC_AUTH.DEVICE_ID)) {
      localStorage.setItem(CC_AUTH.DEVICE_ID, _randHex(16));
      localStorage.setItem(CC_AUTH.DEVICE_LABEL, 'New device');
      localStorage.setItem(CC_AUTH.DEVICE_FIRST, new Date().toISOString());
    }
    localStorage.setItem(CC_AUTH.DEVICE_LAST, new Date().toISOString());
  }

  function ccGetDeviceInfo() {
    return {
      id:       localStorage.getItem(CC_AUTH.DEVICE_ID) || null,
      label:    localStorage.getItem(CC_AUTH.DEVICE_LABEL) || null,
      firstSeen:localStorage.getItem(CC_AUTH.DEVICE_FIRST) || null,
      lastSeen: localStorage.getItem(CC_AUTH.DEVICE_LAST) || null,
      sessionKind: localStorage.getItem(CC_AUTH.SESSION_KEY)
                   ? 'localStorage (Remember-me)'
                   : (sessionStorage.getItem(CC_AUTH.SESSION_KEY) ? 'sessionStorage (this tab)' : 'none'),
      userAgent: navigator.userAgent
    };
  }

  function ccSetDeviceLabel(label) {
    const clean = String(label || '').slice(0, 40).trim();
    if (!clean) throw new Error('Label required');
    localStorage.setItem(CC_AUTH.DEVICE_LABEL, clean);
    return clean;
  }

  // ---- Guard ----------------------------------------------------------
  function _isLoginPage() {
    return /\/(index\.html)?($|\?)/i.test(window.location.pathname + window.location.search);
  }

  function ccGuard() {
    if (ccIsAuthenticated()) {
      ccTouchDevice();
      // If sitting on the login page with a valid session â†’ bounce to home
      if (_isLoginPage()) {
        const redirect = sessionStorage.getItem(CC_AUTH.REDIRECT_KEY);
        sessionStorage.removeItem(CC_AUTH.REDIRECT_KEY);
        window.location.replace(redirect || CC_AUTH.HOME_PAGE);
      }
      return;
    }
    // Not authenticated â€” preserve intended URL and bounce to login
    if (!_isLoginPage()) {
      sessionStorage.setItem(
        CC_AUTH.REDIRECT_KEY,
        window.location.pathname + window.location.search + window.location.hash
      );
      window.location.replace(CC_AUTH.LOGIN_PAGE);
    }
  }

  // ---- Expose ---------------------------------------------------------
  window.CC_AUTH = CC_AUTH;
  window.ccIsAuthenticated = ccIsAuthenticated;
  window.ccLogin           = ccLogin;
  window.ccLogout          = ccLogout;
  window.ccGuard           = ccGuard;
  window.ccSaveNewPassword = ccSaveNewPassword;
  window.ccClearOverride   = ccClearOverride;
  window.ccSetPassword     = ccSetPassword;
  window.ccTouchDevice     = ccTouchDevice;
  window.ccGetDeviceInfo   = ccGetDeviceInfo;
  window.ccSetDeviceLabel  = ccSetDeviceLabel;

  // Auto-run guard as soon as the script loads.
  ccGuard();
})();
