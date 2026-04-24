/* AZCK Command Centre — auth.js v5.1
 * v5   (2026-04-22): Supabase Auth JWT replaces client-side hash gate.
 * v5.1 (2026-04-24): Device sync → cc_devices; remote logout; layout sync helpers.
 */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://twrlvnfszohyrmivdhre.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3cmx2bmZzem9oeXJtaXZkaHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjkxMTMsImV4cCI6MjA5MDE0NTExM30.o96DFNbBObst0EAmX51rnRFXzu8oTN1o-HNAxN7MY8A';

  const CC_AUTH = {
    REDIRECT_KEY:   'azck_cc_redirect',
    LOGIN_PAGE:     'index.html',
    HOME_PAGE:      'dashboard.html',
    DEVICE_ID:      'azck_device_id',
    DEVICE_LABEL:   'azck_device_label',
    DEVICE_FIRST:   'azck_device_first_seen',
    DEVICE_LAST:    'azck_device_last_seen',
    DEVICE_SUPA_ID: 'azck_device_supabase_id',
  };

  let _supa = null;
  let _supaLoading = null;

  function _loadSupabase() {
    if (window.supabase) return Promise.resolve();
    if (_supaLoading) return _supaLoading;
    _supaLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return _supaLoading;
  }

  async function _client() {
    if (!_supa) {
      await _loadSupabase();
      _supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
    return _supa;
  }

  function _hide() { try { document.body.style.visibility = 'hidden'; } catch(e) {} }
  function _show() { try { document.body.style.visibility = ''; } catch(e) {} }

  // ---- Auth ---------------------------------------------------------------
  async function ccIsAuthenticated() {
    const c = await _client();
    const { data } = await c.auth.getSession();
    return !!(data && data.session);
  }

  async function ccLogin(email, password) {
    const c = await _client();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    ccTouchDevice();
    ccSyncDevice().catch(() => {});
    return !!data.session;
  }

  async function ccLogout() {
    const c = await _client();
    await c.auth.signOut();
    window.location.href = CC_AUTH.LOGIN_PAGE;
  }

  // ---- Guard --------------------------------------------------------------
  function _page() {
    return (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
  }
  function _isLogin()  { const p = _page(); return p === '' || p === 'index.html'; }
  function _isPublic() { const p = _page(); return _isLogin() || p === 'reset-password.html'; }

  async function ccGuard() {
    if (_isPublic()) {
      const authed = await ccIsAuthenticated();
      if (authed && _isLogin()) {
        const redir = sessionStorage.getItem(CC_AUTH.REDIRECT_KEY);
        sessionStorage.removeItem(CC_AUTH.REDIRECT_KEY);
        window.location.replace(redir || CC_AUTH.HOME_PAGE);
        return;
      }
      _show();
      return;
    }
    _hide();
    const authed = await ccIsAuthenticated();
    if (authed) {
      ccTouchDevice();
      ccSyncDevice().catch(() => {});
      _show();
    } else {
      sessionStorage.setItem(
        CC_AUTH.REDIRECT_KEY,
        window.location.pathname + window.location.search + window.location.hash
      );
      window.location.replace(CC_AUTH.LOGIN_PAGE);
    }
  }

  // ---- Device identity (localStorage) ------------------------------------
  function _hex(n) {
    const b = new Uint8Array(n / 2);
    crypto.getRandomValues(b);
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function ccTouchDevice() {
    if (!localStorage.getItem(CC_AUTH.DEVICE_ID)) {
      localStorage.setItem(CC_AUTH.DEVICE_ID,    _hex(16));
      localStorage.setItem(CC_AUTH.DEVICE_LABEL, 'New device');
      localStorage.setItem(CC_AUTH.DEVICE_FIRST, new Date().toISOString());
    }
    localStorage.setItem(CC_AUTH.DEVICE_LAST, new Date().toISOString());
  }

  function ccGetDeviceInfo() {
    return {
      id:          localStorage.getItem(CC_AUTH.DEVICE_ID)      || null,
      supabaseId:  localStorage.getItem(CC_AUTH.DEVICE_SUPA_ID) || null,
      label:       localStorage.getItem(CC_AUTH.DEVICE_LABEL)   || null,
      firstSeen:   localStorage.getItem(CC_AUTH.DEVICE_FIRST)   || null,
      lastSeen:    localStorage.getItem(CC_AUTH.DEVICE_LAST)    || null,
      sessionKind: 'supabase',
      userAgent:   navigator.userAgent,
    };
  }

  function ccSetDeviceLabel(label) {
    const s = String(label || '').slice(0, 40).trim();
    if (!s) throw new Error('Label required');
    localStorage.setItem(CC_AUTH.DEVICE_LABEL, s);
    ccSyncDevice().catch(() => {});
    return s;
  }

  // ---- Device sync to Supabase cc_devices --------------------------------
  async function ccSyncDevice() {
    const c = await _client();
    const { data: { user } } = await c.auth.getUser();
    if (!user) return;

    const supaId = localStorage.getItem(CC_AUTH.DEVICE_SUPA_ID);
    const label  = localStorage.getItem(CC_AUTH.DEVICE_LABEL) || 'New device';
    const ua     = navigator.userAgent;
    const now    = new Date().toISOString();

    if (supaId) {
      await c.from('cc_devices')
        .update({ last_seen: now, label, user_agent: ua })
        .eq('id', supaId)
        .eq('user_id', user.id);
    } else {
      const first = localStorage.getItem(CC_AUTH.DEVICE_FIRST) || now;
      const { data } = await c.from('cc_devices')
        .insert({ user_id: user.id, label, user_agent: ua, first_seen: first, last_seen: now })
        .select('id')
        .single();
      if (data?.id) localStorage.setItem(CC_AUTH.DEVICE_SUPA_ID, data.id);
    }
  }

  // ---- All devices for current user (devices.html) -----------------------
  async function ccGetAllDevices() {
    const c = await _client();
    const { data: { user } } = await c.auth.getUser();
    if (!user) return [];
    const { data } = await c.from('cc_devices')
      .select('id,label,user_agent,first_seen,last_seen')
      .eq('user_id', user.id)
      .order('last_seen', { ascending: false });
    return data || [];
  }

  // ---- Remote logout — delete row; if own device → full sign-out ---------
  async function ccRemoteLogout(deviceSupabaseId) {
    const c = await _client();
    await c.from('cc_devices').delete().eq('id', deviceSupabaseId);
    const ownId = localStorage.getItem(CC_AUTH.DEVICE_SUPA_ID);
    if (deviceSupabaseId === ownId) {
      localStorage.removeItem(CC_AUTH.DEVICE_SUPA_ID);
      await c.auth.signOut();
      window.location.href = CC_AUTH.LOGIN_PAGE;
    }
  }

  // ---- Password reset -----------------------------------------------------
  async function ccSendPasswordReset(email) {
    const c = await _client();
    const { error } = await c.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://command.azcustomknives.com/index.html'
    });
    if (error) throw error;
  }

  function ccSaveNewPassword() { throw new Error('Use the email password reset link instead.'); }
  function ccClearOverride()   { throw new Error('Use the email password reset link instead.'); }
  function ccSetPassword()     { throw new Error('Use the email password reset link instead.'); }

  // ---- Expose -------------------------------------------------------------
  window.CC_AUTH             = CC_AUTH;
  window.ccIsAuthenticated   = ccIsAuthenticated;
  window.ccLogin             = ccLogin;
  window.ccLogout            = ccLogout;
  window.ccGuard             = ccGuard;
  window.ccTouchDevice       = ccTouchDevice;
  window.ccGetDeviceInfo     = ccGetDeviceInfo;
  window.ccSetDeviceLabel    = ccSetDeviceLabel;
  window.ccSyncDevice        = ccSyncDevice;
  window.ccGetAllDevices     = ccGetAllDevices;
  window.ccRemoteLogout      = ccRemoteLogout;
  window.ccSendPasswordReset = ccSendPasswordReset;
  window.ccSaveNewPassword   = ccSaveNewPassword;
  window.ccClearOverride     = ccClearOverride;
  window.ccSetPassword       = ccSetPassword;

  ccGuard();
})();
