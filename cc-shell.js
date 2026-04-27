/* ═══════════════════════════════════════════════════════════════
   cc-shell.js — AZCK Command Centre unified shell engine
   v2.1 — 2026-04-18 (Forge v0.9.5 The Operator, Track B rebuild)
   v2.0 — 2026-04-18 (grouped nav)
   v1.0 — 2026-04-17 (initial)

   v2.1 changes:
   - Loads cc-theme.json on boot and applies it as CSS custom
     properties on :root BEFORE rendering. Missing file = no-op
     (cc-shell.css defaults apply). This means Alessio can re-skin
     the entire CC by editing one JSON file — no code touching.

   v2.0 changes:
   - Supports GROUPED nav via cc-config.json `navGroups`
     (TODAY/OPERATIONS/SYSTEMS/STRATEGY/REFERENCE). Falls back to
     flat `nav` if `navGroups` absent, so legacy configs keep working.
   - Nav items inside groups remain drag-reorderable; group headers
     are visual separators, not drag targets.

   On load:
   1. Fetch cc-theme.json → inject CSS variables on :root
   2. Fetch cc-config.json (quickview + default nav order)
   3. Read window.PAGE (per-page config)
   4. Inject banner / quickview / sub-tabs / stats bar
   5. Wire HTML5 drag-reorder on both nav levels (localStorage persist)
   6. Wire sub-tab switching (show/hide sections)
   7. Conditionally render action buttons + view toggle (per PAGE)
   8. Expose window.CC API

   Contract: pages declare window.PAGE BEFORE this script loads.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── 1. DEFAULTS + STATE ─────────────────────────────────
  var DEFAULT_CONFIG = {
    brand: { text: 'AZCK', sub: 'Command Centre', link: 'alessio.html' },
    nav: [
      { id: 'tasks',     label: 'Tasks',     href: 'alessio.html' },
      { id: 'shared',    label: 'Shared',    href: 'shared.html' },
      { id: 'timesheet', label: 'Timesheet', href: 'timesheet.html' },
      { id: 'forge',     label: 'Forge',     href: 'forge.html' },
      { id: 'roadmap',   label: 'Roadmap',   href: 'roadmap.html' },
      { id: 'usage',     label: 'Usage',     href: 'usage.html' },
      { id: 'network',   label: 'Network',   href: 'network.html' }
    ],
    quickview: [
      { icon: '💡', label: 'Tip', value: 'Drag nav pills to reorder · reset button restores defaults' }
    ]
  };
  var KEY_NAV = 'cc.navOrder.v1';
  var KEY_SUBTAB_ORDER = function (pid) { return 'cc.subtabOrder.' + pid + '.v1'; };
  var KEY_VIEW = function (pid) { return 'cc.view.' + pid + '.v1'; };
  var KEY_ACTIVE_SUBTAB = function (pid) { return 'cc.activeSubtab.' + pid + '.v1'; };
  var KEY_VOICE_CLICK_READ = 'cc.voice.clickRead.v1';
  var KEY_VOICE_AUTO_BUS   = 'cc.voice.autoBus.v1';
  var KEY_VOICE_VOLUME     = 'cc.voice.volume.v1';
  var KEY_VOICE_NAME       = 'cc.voice.name.v1';

  var state = {
    config: null,
    page: window.PAGE || { id: 'unknown', title: 'Command Centre', subtabs: [], stats: [], actions: [], views: [] },
    actionRegistry: {},
    subtabListeners: [],
    viewListeners: []
  };

  // ─── 2. UTILS ────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, opts) {
    var e = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) e.className = opts.cls;
    if (opts.html !== undefined) e.innerHTML = opts.html;
    if (opts.text !== undefined) e.textContent = opts.text;
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { e.setAttribute(k, opts.attrs[k]); });
    if (opts.on) Object.keys(opts.on).forEach(function (k) { e.addEventListener(k, opts.on[k]); });
    if (opts.children) opts.children.forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function readLS(k, fallback) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function removeLS(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ─── 2b. VOICE MODULE ────────────────────────────────────
  var _clickReadOn = readLS(KEY_VOICE_CLICK_READ, true);
  var _autoBusOn   = readLS(KEY_VOICE_AUTO_BUS, true);
  var _voiceVolume = readLS(KEY_VOICE_VOLUME, 0.85);
  var _voiceName   = readLS(KEY_VOICE_NAME, '');
  var _voiceChangeCb = null;

  function _rawSpeak(text) {
    if (document.visibilityState !== 'visible') return;
    if (!('speechSynthesis' in window)) return;
    try {
      var txt = text && text.length > 500 ? text.substring(0, 500) + '.' : (text || '');
      if (!txt.trim()) return;
      window.speechSynthesis.cancel();
      var utt = new SpeechSynthesisUtterance(txt);
      utt.volume = typeof _voiceVolume === 'number' ? _voiceVolume : 0.85;
      if (_voiceName) {
        var vs = window.speechSynthesis.getVoices();
        for (var vi = 0; vi < vs.length; vi++) { if (vs[vi].name === _voiceName) { utt.voice = vs[vi]; break; } }
      }
      window.speechSynthesis.speak(utt);
    } catch (e) {}
  }

  // speakText = auto-bus gated (called from fleet.html / alessio.html Realtime callbacks)
  function speakText(text) {
    if (!_autoBusOn) return;
    _rawSpeak(text);
  }

  function _setClickReadOn(val) {
    _clickReadOn = !!val;
    writeLS(KEY_VOICE_CLICK_READ, _clickReadOn);
    var btn = document.getElementById('cc-voice-click-btn');
    if (btn) btn.classList.toggle('cc-voice-btn-active', _clickReadOn);
    if (_voiceChangeCb) _voiceChangeCb('voice_click_read', _clickReadOn);
  }

  function _setAutoBusOn(val) {
    _autoBusOn = !!val;
    writeLS(KEY_VOICE_AUTO_BUS, _autoBusOn);
    var btn = document.getElementById('cc-voice-bus-btn');
    if (btn) btn.classList.toggle('cc-voice-btn-active', _autoBusOn);
    if (_voiceChangeCb) _voiceChangeCb('voice_auto_bus', _autoBusOn);
  }

  function _setVolume(val) {
    _voiceVolume = parseFloat(val) || 0.85;
    writeLS(KEY_VOICE_VOLUME, _voiceVolume);
    if (_voiceChangeCb) _voiceChangeCb('voice_volume', _voiceVolume);
  }

  function _setVoiceName(name) {
    _voiceName = name;
    writeLS(KEY_VOICE_NAME, name);
    if (_voiceChangeCb) _voiceChangeCb('voice_preference', name);
  }

  function _populateVoicePicker() {
    var sel = document.getElementById('cc-voice-picker');
    if (!sel || !('speechSynthesis' in window)) return;
    var vs = window.speechSynthesis.getVoices();
    if (!vs.length) return;
    var prev = sel.value;
    sel.innerHTML = '';
    vs.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = opt.textContent = v.name;
      if (v.name === (prev || _voiceName)) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!_voiceName && vs.length) { _voiceName = vs[0].name; writeLS(KEY_VOICE_NAME, _voiceName); }
  }

  function _initClickToRead() {
    if (!('speechSynthesis' in window) || !('getSelection' in window)) return;
    var btn = document.createElement('button');
    btn.id = 'cc-voice-read-btn';
    btn.textContent = '🔊 Read';
    btn.style.display = 'none';
    document.body.appendChild(btn);

    var hideBtn = function () { btn.style.display = 'none'; };

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var sel = window.getSelection();
      var txt = sel ? sel.toString().trim() : '';
      if (txt) _rawSpeak(txt);
      hideBtn();
    });

    document.addEventListener('selectionchange', function () {
      if (!_clickReadOn) { hideBtn(); return; }
      var sel = window.getSelection();
      if (!sel || !sel.toString().trim()) { hideBtn(); return; }
      try {
        var range = sel.getRangeAt(0);
        var rect = range.getBoundingClientRect();
        if (!rect || rect.width === 0) { hideBtn(); return; }
        btn.style.left = (rect.left + window.scrollX + rect.width / 2 - 30) + 'px';
        btn.style.top  = (rect.top  + window.scrollY - 40) + 'px';
        btn.style.display = '';
      } catch (ex) { hideBtn(); }
    });

    document.addEventListener('mousedown', function (e) {
      if (e.target !== btn) hideBtn();
    });
  }

  // ─── 2c. CMD+K PALETTE MODULE ────────────────────────────
  var _paletteEl    = null;
  var _paletteDataFn = null;
  var _paletteCache = { ts: 0, items: [] };
  var _PALETTE_TTL  = 30000;

  function _buildStaticPaletteItems() {
    var items = [];
    var cfg = state.config || {};
    var navItems = [];
    if (cfg.navGroups && Array.isArray(cfg.navGroups)) {
      cfg.navGroups.forEach(function (g) { (g.items || []).forEach(function (n) { navItems.push(n); }); });
    } else {
      navItems = cfg.nav || [];
    }
    navItems.forEach(function (n) {
      items.push({ id: 'nav-' + n.id, title: n.label, section: 'Navigation',
        handler: function () { window.location.href = n.href; } });
    });
    var page = state.page;
    if (page && page.subtabs) {
      page.subtabs.forEach(function (t) {
        items.push({ id: 'tab-' + t.id, title: t.label, section: 'Subtabs',
          handler: function () { if (typeof setSubtab === 'function') setSubtab(t.id); } });
      });
    }
    return items;
  }

  function _openPalette() {
    if (!_paletteEl) return;
    var base = _buildStaticPaletteItems();
    var now = Date.now();
    if (now - _paletteCache.ts < _PALETTE_TTL) {
      _paletteEl.data = base.concat(_paletteCache.items);
      _paletteEl.open();
    } else if (_paletteDataFn) {
      _paletteDataFn().then(function (live) {
        _paletteCache = { ts: Date.now(), items: live || [] };
        _paletteEl.data = base.concat(_paletteCache.items);
        _paletteEl.open();
      }).catch(function () { _paletteEl.data = base; _paletteEl.open(); });
    } else {
      _paletteEl.data = base;
      _paletteEl.open();
    }
  }

  function _initPalette() {
    // ninja-keys custom element must be defined before we can create it
    var tryInit = function () {
      if (!customElements.get('ninja-keys')) return;
      _paletteEl = document.createElement('ninja-keys');
      _paletteEl.id = 'cc-palette';
      document.body.appendChild(_paletteEl);
      document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          _openPalette();
        }
      });
    };
    // Try now; if not yet defined, wait for the element to register
    tryInit();
    if (!_paletteEl && customElements.whenDefined) {
      customElements.whenDefined('ninja-keys').then(tryInit);
    }
  }

  // ─── 2d. STATUS PIPS MODULE ──────────────────────────────
  function _applyPip(tabId, color) {
    var navA = document.querySelector('.cc-nav-item[data-id="' + tabId + '"]');
    if (!navA) return;
    var pip = navA.querySelector('.cc-pip');
    if (!pip) { pip = document.createElement('span'); pip.className = 'cc-pip'; navA.appendChild(pip); }
    pip.className = 'cc-pip cc-pip-' + (color || 'empty');
  }

  // ─── 3. CONFIG LOAD ──────────────────────────────────────
  function loadConfig(cb) {
    fetch('cc-config.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        state.config = cfg || DEFAULT_CONFIG;
        // Merge sensible defaults for missing keys
        if (!state.config.brand) state.config.brand = DEFAULT_CONFIG.brand;
        if (!state.config.nav) state.config.nav = DEFAULT_CONFIG.nav;
        if (!state.config.quickview) state.config.quickview = DEFAULT_CONFIG.quickview;
        cb();
      })
      .catch(function () { state.config = DEFAULT_CONFIG; cb(); });
  }

  // ─── 3b. THEME LOAD (CSS variable injection) ─────────────
  // cc-theme.json → CSS custom property map. Keys translate:
  //   color.bg          → --cc-bg
  //   color.bg-card     → --cc-bg-card
  //   radius.sm         → --cc-r-sm
  //   spacing.md        → --cc-pad-md
  //   font.body         → --cc-font
  //   font.mono         → --cc-font-mono
  // Unknown keys silently ignored. Missing theme file = no-op;
  // cc-shell.css defaults apply.
  var THEME_MAP = {
    'color.bg':          '--cc-bg',
    'color.bg-card':     '--cc-bg-card',
    'color.bg-raised':   '--cc-bg-raised',
    'color.bg-hover':    '--cc-bg-hover',
    'color.border':      '--cc-border',
    'color.border-soft': '--cc-border-soft',
    'color.text':        '--cc-text',
    'color.text-body':   '--cc-text-body',
    'color.text-muted':  '--cc-text-muted',
    'color.text-dim':    '--cc-text-dim',
    'color.accent':      '--cc-accent',
    'color.success':     '--cc-success',
    'color.warn':        '--cc-warn',
    'color.danger':      '--cc-danger',
    'radius.sm':         '--cc-r-sm',
    'radius.md':         '--cc-r-md',
    'radius.lg':         '--cc-r-lg',
    'radius.pill':       '--cc-r-pill',
    'spacing.xs':        '--cc-pad-xs',
    'spacing.sm':        '--cc-pad-sm',
    'spacing.md':        '--cc-pad-md',
    'spacing.lg':        '--cc-pad-lg',
    'spacing.xl':        '--cc-pad-xl',
    'font.body':         '--cc-font',
    'font.mono':         '--cc-font-mono'
  };

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    var root = document.documentElement;
    Object.keys(THEME_MAP).forEach(function (dotKey) {
      var parts = dotKey.split('.');
      var v = theme;
      for (var i = 0; i < parts.length; i++) {
        if (v == null || typeof v !== 'object') { v = null; break; }
        v = v[parts[i]];
      }
      if (typeof v === 'string' && v.length) {
        root.style.setProperty(THEME_MAP[dotKey], v);
      }
    });
  }

  function loadTheme(cb) {
    fetch('cc-theme.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (theme) { applyTheme(theme); cb(); })
      .catch(function () { cb(); });
  }

  // ─── 4. DRAG-REORDER (generic, used for both nav levels) ──
  function makeDraggable(containerSel, itemSel, onReorder) {
    var container = $(containerSel);
    if (!container) return;
    var dragging = null;

    $$(itemSel, container).forEach(function (item) {
      item.setAttribute('draggable', 'true');

      item.addEventListener('dragstart', function (e) {
        dragging = item;
        item.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.dataset.id || ''); } catch (err) {}
      });
      item.addEventListener('dragend', function () {
        if (dragging) dragging.classList.remove('dragging');
        $$(itemSel, container).forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
        dragging = null;
      });
      item.addEventListener('dragover', function (e) {
        if (!dragging || dragging === item) return;
        e.preventDefault();
        var rect = item.getBoundingClientRect();
        var before = (e.clientX - rect.left) < rect.width / 2;
        $$(itemSel, container).forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
        item.classList.add(before ? 'drop-before' : 'drop-after');
      });
      item.addEventListener('drop', function (e) {
        if (!dragging || dragging === item) return;
        e.preventDefault();
        var rect = item.getBoundingClientRect();
        var before = (e.clientX - rect.left) < rect.width / 2;
        container.insertBefore(dragging, before ? item : item.nextSibling);
        item.classList.remove('drop-before', 'drop-after');
        // Persist new order
        var ids = $$(itemSel, container).map(function (x) { return x.dataset.id; });
        onReorder(ids);
      });
    });
  }

  // ─── 5. BANNER + MAIN NAV ────────────────────────────────
  function renderBanner() {
    var cfg = state.config;
    var savedOrder = readLS(KEY_NAV, null);

    // Backward compatibility: if `navGroups` exists use grouped render,
    // else fall back to flat `nav`. Flat nav items become a single
    // pseudo-group with no label.
    var groups;
    if (cfg.navGroups && Array.isArray(cfg.navGroups)) {
      groups = cfg.navGroups.map(function (g) {
        return { id: g.id, label: g.label, items: (g.items || []).slice() };
      });
    } else {
      groups = [{ id: '_flat', label: null, items: (cfg.nav || []).slice() }];
    }

    // Apply saved order: savedOrder is a flat list of ids across all groups.
    // Re-sort each group's items by the saved order; items not in savedOrder
    // stay in their config position.
    if (savedOrder && Array.isArray(savedOrder)) {
      var orderIndex = {};
      savedOrder.forEach(function (id, i) { orderIndex[id] = i; });
      groups.forEach(function (g) {
        g.items.sort(function (a, b) {
          var ai = orderIndex[a.id], bi = orderIndex[b.id];
          if (ai === undefined && bi === undefined) return 0;
          if (ai === undefined) return 1;
          if (bi === undefined) return -1;
          return ai - bi;
        });
      });
    }

    var brand = el('a', {
      cls: 'cc-brand',
      attrs: { href: cfg.brand.link || '#' },
      html: cfg.brand.text + (cfg.brand.sub ? '<span class="cc-brand-sub">' + cfg.brand.sub + '</span>' : '')
    });

    var nav = el('nav', { cls: 'cc-nav', attrs: { id: 'cc-nav' } });
    groups.forEach(function (g, gi) {
      if (g.label) {
        var lbl = el('span', {
          cls: 'cc-nav-group-label',
          attrs: { 'data-group-id': g.id },
          text: g.label
        });
        nav.appendChild(lbl);
      }
      g.items.forEach(function (n) {
        var a = el('a', {
          cls: 'cc-nav-item',
          attrs: { href: n.href, 'data-id': n.id, 'data-group': g.id },
          text: n.label
        });
        if (n.id === state.page.id) a.classList.add('active');
        a.appendChild(el('span', { cls: 'cc-pip cc-pip-empty' }));
        nav.appendChild(a);
      });
      if (gi < groups.length - 1) {
        nav.appendChild(el('span', { cls: 'cc-nav-group-sep', attrs: { 'aria-hidden': 'true' }, text: '' }));
      }
    });

    var actions = el('div', { cls: 'cc-banner-actions', children: [
      el('button', { text: 'Reset nav', attrs: { title: 'Clear saved order — restore JSON defaults' },
        on: { click: function () { removeLS(KEY_NAV); location.reload(); } } }),
      el('button', { text: 'Log out', attrs: { title: 'Sign out of the Command Centre', 'data-cc-logout': '1' },
        on: { click: function () {
          if (typeof ccLogout === 'function') { ccLogout(); }
          else { try { sessionStorage.removeItem('azck_cc_auth'); } catch(e){} window.location.href = 'index.html'; }
        } } })
    ]});

    // Voice controls (v2): click-read toggle · auto-bus toggle · voice picker · volume slider
    if ('speechSynthesis' in window) {
      var _vClickBtn = el('button', {
        text: '🔊',
        attrs: { id: 'cc-voice-click-btn', title: 'Click-to-read: select text to get a Read button' },
        on: { click: function () { _setClickReadOn(!_clickReadOn); } }
      });
      if (_clickReadOn) _vClickBtn.classList.add('cc-voice-btn-active');

      var _vBusBtn = el('button', {
        text: '📡',
        attrs: { id: 'cc-voice-bus-btn', title: 'Auto-read incoming bus messages aloud' },
        on: { click: function () { _setAutoBusOn(!_autoBusOn); } }
      });
      if (_autoBusOn) _vBusBtn.classList.add('cc-voice-btn-active');

      var _vSel = document.createElement('select');
      _vSel.id = 'cc-voice-picker';
      _vSel.title = 'Select voice';
      _vSel.addEventListener('change', function () { _setVoiceName(this.value); });

      var _vVolWrap = el('div', { cls: 'cc-voice-vol-wrap' });
      var _vVolIcon = el('span', { cls: 'cc-voice-vol-icon', text: '🔉' });
      var _vVolSlider = document.createElement('input');
      _vVolSlider.type = 'range'; _vVolSlider.id = 'cc-voice-volume';
      _vVolSlider.min = '0'; _vVolSlider.max = '1'; _vVolSlider.step = '0.05';
      _vVolSlider.value = String(_voiceVolume);
      _vVolSlider.title = 'Voice volume';
      _vVolSlider.addEventListener('input', function () { _setVolume(this.value); });
      _vVolWrap.appendChild(_vVolIcon);
      _vVolWrap.appendChild(_vVolSlider);

      // Order: [🔊] [📡] [picker] [🔉 slider] — insert reversed so firstChild works
      actions.insertBefore(_vVolWrap, actions.firstChild);
      actions.insertBefore(_vSel, actions.firstChild);
      actions.insertBefore(_vBusBtn, actions.firstChild);
      actions.insertBefore(_vClickBtn, actions.firstChild);

      _populateVoicePicker();
      if ('onvoiceschanged' in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = _populateVoicePicker;
      }
    }

    var banner = el('header', { cls: 'cc-banner', children: [brand, nav, actions] });
    document.body.insertBefore(banner, document.body.firstChild);

    // Drag-reorder only the <a.cc-nav-item> links (not labels/separators).
    // Persist as flat id list — render() re-slots into groups by id.
    makeDraggable('#cc-nav', 'a.cc-nav-item', function (ids) { writeLS(KEY_NAV, ids); });
  }

  // ─── 6. QUICKVIEW STRIP ──────────────────────────────────
  function renderQuickview() {
    var items = (state.config.quickview || []).slice();
    if (!items.length) return;
    var strip = el('div', { cls: 'cc-quickview', attrs: { id: 'cc-quickview' } });
    items.forEach(function (q) {
      var valNode;
      if (q.link) {
        valNode = el('a', { cls: 'cc-qv-value', attrs: { href: q.link, target: q.external ? '_blank' : '_self' }, text: q.value });
      } else {
        valNode = el('span', { cls: 'cc-qv-value', text: q.value });
      }
      var item = el('div', { cls: 'cc-qv-item', children: [
        el('span', { cls: 'cc-qv-icon', text: q.icon || '•' }),
        el('span', { cls: 'cc-qv-label', text: q.label || '' }),
        valNode
      ]});
      strip.appendChild(item);
    });
    var banner = $('.cc-banner');
    banner.parentNode.insertBefore(strip, banner.nextSibling);
  }

  // ─── 7. SUB-TABS (per page) ──────────────────────────────
  function renderSubtabs() {
    var page = state.page;
    if (!page.subtabs || !page.subtabs.length) return;

    var savedOrder = readLS(KEY_SUBTAB_ORDER(page.id), null);
    var tabs = page.subtabs.slice();
    if (savedOrder && Array.isArray(savedOrder)) {
      var byId = {};
      tabs.forEach(function (t) { byId[t.id] = t; });
      var ordered = [];
      savedOrder.forEach(function (id) { if (byId[id]) { ordered.push(byId[id]); delete byId[id]; } });
      Object.keys(byId).forEach(function (id) { ordered.push(byId[id]); });
      tabs = ordered;
    }

    var activeId = readLS(KEY_ACTIVE_SUBTAB(page.id), null) || tabs[0].id;

    var bar = el('div', { cls: 'cc-subtabs', attrs: { id: 'cc-subtabs' } });
    tabs.forEach(function (t) {
      var btn = el('button', {
        cls: 'cc-subtab' + (t.id === activeId ? ' active' : ''),
        attrs: { 'data-id': t.id, type: 'button' },
        text: t.label,
        on: { click: function () { setSubtab(t.id); } }
      });
      bar.appendChild(btn);
    });

    var qv = $('.cc-quickview');
    var banner = $('.cc-banner');
    var anchor = qv || banner;
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);

    makeDraggable('#cc-subtabs', '.cc-subtab', function (ids) { writeLS(KEY_SUBTAB_ORDER(page.id), ids); });

    // Apply initial visibility
    applySubtabVisibility(activeId);
  }

  function setSubtab(id) {
    writeLS(KEY_ACTIVE_SUBTAB(state.page.id), id);
    $$('#cc-subtabs .cc-subtab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.id === id);
    });
    applySubtabVisibility(id);
    state.subtabListeners.forEach(function (fn) { try { fn(id); } catch (e) {} });
  }

  function applySubtabVisibility(id) {
    // Pages may mark content sections with data-subtab="<id>".
    // Shell hides non-matching, shows matching. If page has its own
    // tab-switching logic, this is additive (no conflict).
    var sections = $$('[data-subtab]');
    if (!sections.length) return;  // page handles its own
    sections.forEach(function (s) {
      s.style.display = (s.dataset.subtab === id) ? '' : 'none';
    });
  }

  // ─── 8. STATS BAR ────────────────────────────────────────
  function renderStatsBar() {
    var stats = state.page.stats;
    if (!stats || !stats.length) return;
    var bar = el('div', { cls: 'cc-statsbar', attrs: { id: 'cc-statsbar' } });
    updateStatsContent(bar, stats);
    var anchor = $('.cc-subtabs') || $('.cc-quickview') || $('.cc-banner');
    if (!anchor || !anchor.parentNode) return;  // shell not ready yet — skip; next updateStats call will retry
    anchor.parentNode.insertBefore(bar, anchor.nextSibling);
  }
  function updateStatsContent(bar, stats) {
    bar.innerHTML = '';
    stats.forEach(function (s) {
      var item = el('div', { cls: 'cc-stat' + (s.tone ? ' cc-stat-' + s.tone : ''), children: [
        el('span', { cls: 'cc-stat-label', text: s.label }),
        el('span', { cls: 'cc-stat-value', text: s.value })
      ]});
      bar.appendChild(item);
    });
  }

  // ─── 9. VIEW TOOLBAR (task pages only) ───────────────────
  function renderViewToolbar() {
    var page = state.page;
    var hasViews = page.views && page.views.length;
    var hasActions = page.actions && page.actions.length;
    if (!hasViews && !hasActions) return;

    // Find content area — conventionally #cc-content or <main>
    var content = $('#cc-content') || $('main') || document.body;
    var toolbar = el('div', { cls: 'cc-view-toolbar' });

    if (hasViews) {
      var savedView = readLS(KEY_VIEW(page.id), null) || page.activeView || page.views[0].id;
      var modes = el('div', { cls: 'cc-view-modes' });
      page.views.forEach(function (v) {
        var btn = el('button', {
          cls: v.id === savedView ? 'active' : '',
          attrs: { 'data-view': v.id, type: 'button' },
          text: v.label,
          on: { click: function () { setView(v.id); } }
        });
        modes.appendChild(btn);
      });
      toolbar.appendChild(modes);
      state.currentView = savedView;
    }

    if (hasActions) {
      var actions = el('div', { cls: 'cc-actions' });
      page.actions.forEach(function (a) {
        var btn = el('button', {
          cls: 'cc-btn' + (a.variant === 'primary' ? ' cc-btn-primary' : ''),
          attrs: { type: 'button' },
          text: a.label,
          on: { click: function () {
            var fn = state.actionRegistry[a.onClick];
            if (typeof fn === 'function') fn();
            else console.warn('[cc-shell] No handler registered for action:', a.onClick);
          }}
        });
        actions.appendChild(btn);
      });
      toolbar.appendChild(actions);
    }

    // Insert at top of content
    content.insertBefore(toolbar, content.firstChild);
  }

  function setView(id) {
    writeLS(KEY_VIEW(state.page.id), id);
    state.currentView = id;
    $$('.cc-view-modes button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === id);
    });
    state.viewListeners.forEach(function (fn) { try { fn(id); } catch (e) {} });
  }

  // ─── 10. WRAP CONTENT ────────────────────────────────────
  // If the page doesn't already have #cc-content, wrap everything
  // between the shell-injected elements and </body> in a container
  // so margins/max-width behave consistently.
  function wrapContent() {
    if ($('#cc-content')) return;
    var existing = $('main');
    if (existing) { existing.id = 'cc-content'; existing.classList.add('cc-content'); return; }
    // Otherwise wrap loose body children
    var wrap = el('main', { cls: 'cc-content', attrs: { id: 'cc-content' } });
    var nodes = [];
    for (var i = 0; i < document.body.children.length; i++) {
      var n = document.body.children[i];
      if (n.classList && (n.classList.contains('cc-banner') || n.classList.contains('cc-quickview') ||
                          n.classList.contains('cc-subtabs') || n.classList.contains('cc-statsbar'))) continue;
      nodes.push(n);
    }
    nodes.forEach(function (n) { wrap.appendChild(n); });
    document.body.appendChild(wrap);
  }

  // ─── 11. PUBLIC API ──────────────────────────────────────
  window.CC = {
    // Sub-tabs
    getSubtab: function () { return readLS(KEY_ACTIVE_SUBTAB(state.page.id), (state.page.subtabs[0] || {}).id); },
    setSubtab: setSubtab,
    onSubtabChange: function (fn) { state.subtabListeners.push(fn); },

    // Views
    getView: function () { return state.currentView; },
    setView: setView,
    onViewChange: function (fn) { state.viewListeners.push(fn); },

    // Stats bar updates
    updateStats: function (stats) {
      state.page.stats = stats || [];
      var bar = $('#cc-statsbar');
      if (bar) updateStatsContent(bar, state.page.stats);
      else renderStatsBar();
    },

    // Action registration (for +Add Task etc.)
    registerAction: function (name, fn) { state.actionRegistry[name] = fn; },

    // Reset helpers
    resetNav: function () { removeLS(KEY_NAV); location.reload(); },
    resetSubtabOrder: function () { removeLS(KEY_SUBTAB_ORDER(state.page.id)); location.reload(); },
    resetAll: function () {
      Object.keys(localStorage).forEach(function (k) { if (k.indexOf('cc.') === 0) localStorage.removeItem(k); });
      location.reload();
    },

    // Voice (Forge Voice v2 — Bus #224)
    voice: {
      speak:         speakText,          // auto-bus gated; called from Realtime callbacks
      isAutoBusOn:   function () { return _autoBusOn; },
      isClickReadOn: function () { return _clickReadOn; },
      setAutoBus:    _setAutoBusOn,
      setClickRead:  _setClickReadOn,
      setVolume:     _setVolume,
      setName:       _setVoiceName,
      // Inject DB settings post-auth: CC.voice.inject({ voice_click_read: true, ... })
      inject: function (s) {
        if (!s) return;
        if (s.voice_click_read !== undefined) _setClickReadOn(s.voice_click_read);
        if (s.voice_auto_bus   !== undefined) _setAutoBusOn(s.voice_auto_bus);
        if (s.voice_volume     !== undefined) _setVolume(s.voice_volume);
        if (s.voice_preference) { _setVoiceName(s.voice_preference); _populateVoicePicker(); }
      },
      // Register save callback: CC.voice.onChange((key, val) => upsertUserSetting(key, val))
      onChange: function (fn) { _voiceChangeCb = fn; }
    },

    // Cmd+K palette (Plan 7abbcc33 Cycle 4)
    palette: {
      open:          _openPalette,
      setDataSource: function (fn) { _paletteDataFn = fn; }
    },

    // Status pips (Plan 7abbcc33 Cycle 4)
    pips: {
      apply: _applyPip
    },

    // Introspection (for debugging)
    _state: state
  };

  // ─── 12. BOOT ────────────────────────────────────────────
  function boot() {
    // Theme first (so first paint uses Alessio's tokens), then config+render.
    loadTheme(function () {
      loadConfig(function () {
        renderBanner();
        renderQuickview();
        renderSubtabs();
        renderStatsBar();
        wrapContent();
        renderViewToolbar();
        _initPalette();
        _initClickToRead();
        // Ready signal
        document.dispatchEvent(new CustomEvent('cc-shell-ready', { detail: { page: state.page } }));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();

/* ═══ END cc-shell.js ═══ */
