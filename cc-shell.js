/* ═══════════════════════════════════════════════════════════════
   cc-shell.js — AZCK Command Centre unified shell engine
   v1.0 — 2026-04-17 (Forge v0.9.5 The Operator)

   On load:
   1. Fetch cc-config.json (quickview + default nav order)
   2. Read window.PAGE (per-page config)
   3. Inject banner / quickview / sub-tabs / stats bar
   4. Wire HTML5 drag-reorder on both nav levels (localStorage persist)
   5. Wire sub-tab switching (show/hide sections)
   6. Conditionally render action buttons + view toggle (per PAGE)
   7. Expose window.CC API

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
    var navItems = cfg.nav.slice();
    // Apply saved order if present (keeping unknown items at the end, dropping removed)
    if (savedOrder && Array.isArray(savedOrder)) {
      var byId = {};
      navItems.forEach(function (n) { byId[n.id] = n; });
      var ordered = [];
      savedOrder.forEach(function (id) { if (byId[id]) { ordered.push(byId[id]); delete byId[id]; } });
      Object.keys(byId).forEach(function (id) { ordered.push(byId[id]); });  // new ones since last save
      navItems = ordered;
    }

    var brand = el('a', {
      cls: 'cc-brand',
      attrs: { href: cfg.brand.link || '#' },
      html: cfg.brand.text + (cfg.brand.sub ? '<span class="cc-brand-sub">' + cfg.brand.sub + '</span>' : '')
    });

    var nav = el('nav', { cls: 'cc-nav', attrs: { id: 'cc-nav' } });
    navItems.forEach(function (n) {
      var a = el('a', {
        attrs: { href: n.href, 'data-id': n.id },
        text: n.label
      });
      if (n.id === state.page.id) a.classList.add('active');
      nav.appendChild(a);
    });

    var actions = el('div', { cls: 'cc-banner-actions', children: [
      el('button', { text: 'Reset nav', attrs: { title: 'Clear saved order — restore JSON defaults' },
        on: { click: function () { removeLS(KEY_NAV); location.reload(); } } })
    ]});

    var banner = el('header', { cls: 'cc-banner', children: [brand, nav, actions] });
    document.body.insertBefore(banner, document.body.firstChild);

    // Enable drag-reorder on nav
    makeDraggable('#cc-nav', 'a', function (ids) { writeLS(KEY_NAV, ids); });
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

    // Introspection (for debugging)
    _state: state
  };

  // ─── 12. BOOT ────────────────────────────────────────────
  function boot() {
    loadConfig(function () {
      renderBanner();
      renderQuickview();
      renderSubtabs();
      renderStatsBar();
      wrapContent();
      renderViewToolbar();
      // Ready signal
      document.dispatchEvent(new CustomEvent('cc-shell-ready', { detail: { page: state.page } }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();

/* ═══ END cc-shell.js ═══ */
