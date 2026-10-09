/* RunButter chat widget — ~3KB, no dependencies. Usage:
   <script defer src="https://runbutter.app/support.js" data-widget="YOUR_WIDGET_ID"></script>

   What it does to the host page: one round button in the corner and, once the
   visitor opens it, one iframe. The chat itself runs INSIDE that iframe on our
   origin, so the host page never sees the visitor's conversation key and no
   CSS can leak in either direction. Nothing loads until the button is pressed,
   unless this visitor already has a conversation going — then the iframe is
   loaded hidden so a reply can light up the button.

   Optional attributes:
     data-position="left"   bottom-left instead of bottom-right
     data-open="true"       open the panel on load (a dedicated contact page)
   And from your own code:
     RunButterChat.open()   RunButterChat.close()                              */
(function () {
  var s = document.currentScript;
  if (!s || window.RunButterChat) return;
  var id = s.getAttribute('data-widget');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
  var origin = new URL(s.src).origin;
  var left = s.getAttribute('data-position') === 'left';
  var FLAG = 'rb-support-active:' + id;
  var flag = function (v) { try { if (v === undefined) return localStorage.getItem(FLAG) === '1'; if (v) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) { return false; } };

  var btn, panel, frame, badge, isOpen = false, frameReady = false, unread = 0, color = '#18181b';

  function css(el, o) { for (var k in o) el.style[k] = o[k]; }
  function textOn(hex) {
    var n = parseInt(String(hex).replace('#', ''), 16); if (isNaN(n)) return '#fff';
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#18181b' : '#fff';
  }
  var ICON_CHAT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_X = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function small() { return window.innerWidth < 480; }
  function layout() {
    if (!panel) return;
    if (small()) css(panel, { left: '0', right: '0', bottom: '0', top: '0', width: '100%', height: '100%', borderRadius: '0' });
    else css(panel, { top: 'auto', bottom: '88px', width: '380px', height: 'min(640px, calc(100vh - 120px))', borderRadius: '16px', left: left ? '20px' : 'auto', right: left ? 'auto' : '20px' });
  }

  function ensureFrame(hidden) {
    if (frame) return;
    panel = document.createElement('div');
    css(panel, { position: 'fixed', zIndex: '2147483000', overflow: 'hidden', boxShadow: '0 12px 48px rgba(0,0,0,.18)', display: 'none', background: '#fff' });
    frame = document.createElement('iframe');
    frame.src = origin + '/support/' + id + '?embed=1';
    frame.title = 'Chat';
    frame.setAttribute('allow', 'clipboard-write');
    css(frame, { width: '100%', height: '100%', border: '0', display: 'block' });
    panel.appendChild(frame);
    document.body.appendChild(panel);
    layout();
    if (!hidden) panel.style.display = 'block';
  }

  function tell() { if (frame && frameReady) frame.contentWindow.postMessage({ type: 'rb-support-open', open: isOpen }, origin); }
  function setUnread(n) {
    unread = n;
    if (!badge) return;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.style.display = n > 0 ? 'flex' : 'none';
  }
  function open() {
    ensureFrame(false);
    isOpen = true; panel.style.display = 'block'; btn.innerHTML = ICON_X; btn.appendChild(badge);
    btn.setAttribute('aria-label', 'Close chat'); setUnread(0);
    if (small()) btn.style.display = 'none';
    tell();
  }
  function close() {
    isOpen = false; if (panel) panel.style.display = 'none';
    btn.innerHTML = ICON_CHAT; btn.appendChild(badge); btn.setAttribute('aria-label', 'Open chat');
    btn.style.display = 'flex';
    tell();
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !frame || e.source !== frame.contentWindow) return;
    var d = e.data || {};
    if (d.type === 'rb-support-ready') { frameReady = true; if (!d.active) flag(false); tell(); }
    else if (d.type === 'rb-support-active') flag(true);
    else if (d.type === 'rb-support-close') close();
    else if (d.type === 'rb-support' && !isOpen) setUnread(unread + (d.unread || 0));
  });
  window.addEventListener('resize', layout);

  function mount(cfg) {
    color = cfg.color || color;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open chat');
    css(btn, { position: 'fixed', bottom: '20px', zIndex: '2147483001', width: '56px', height: '56px', borderRadius: '999px', border: '0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color, color: textOn(color), boxShadow: '0 6px 24px rgba(0,0,0,.2)', padding: '0' });
    css(btn, left ? { left: '20px' } : { right: '20px' });
    badge = document.createElement('span');
    css(badge, { position: 'absolute', top: '-2px', right: '-2px', minWidth: '20px', height: '20px', padding: '0 5px', borderRadius: '999px', background: '#ef4444', color: '#fff', font: '600 11px/20px system-ui,sans-serif', display: 'none', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' });
    btn.innerHTML = ICON_CHAT; btn.appendChild(badge);
    btn.addEventListener('click', function () { isOpen ? close() : open(); });
    document.body.appendChild(btn);
    // A visitor mid-conversation: load the chat hidden, so a reply can show.
    if (flag()) ensureFrame(true);
    if (s.getAttribute('data-open') === 'true') open();
    window.RunButterChat = { open: open, close: close };
  }

  // The widget's look comes from the server, so a colour changed in Settings
  // reaches every site without re-pasting the snippet — and a widget switched
  // off there disappears from the site.
  fetch(origin + '/api/support/visitor?widget=' + encodeURIComponent(id))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.widget) return;
      if (document.body) mount(d.widget); else document.addEventListener('DOMContentLoaded', function () { mount(d.widget); });
    })
    .catch(function () { /* never break the host page */ });
})();
