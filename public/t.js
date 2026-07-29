/* RunButter analytics — cookieless, ~1KB. Usage:
   <script defer src="https://runbutter.app/t.js" data-site="YOUR_SITE_ID"></script> */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute('data-site');
  if (!site) return;
  var api = s.getAttribute('data-api') || new URL(s.src).origin + '/api/t';
  var last = '';

  function send() {
    var p = location.pathname || '/';
    if (p === last) return; // dedupe SPA double-fires
    last = p;
    // Campaign params are read from the URL that is CURRENTLY in the address
    // bar, so an SPA navigation away from the tagged landing URL stops
    // attributing — the first view carries the campaign, later ones don't.
    var q = new URLSearchParams(location.search);
    var body = JSON.stringify({
      s: site,
      p: p,
      r: document.referrer || '',
      w: window.innerWidth || 0,
      utm_source: q.get('utm_source') || '',
      utm_medium: q.get('utm_medium') || '',
      utm_campaign: q.get('utm_campaign') || '',
    });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(api, body);
      else fetch(api, { method: 'POST', body: body, keepalive: true });
    } catch (e) { /* never break the host page */ }
  }

  // initial view + SPA navigations
  send();
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); setTimeout(send, 0); };
  window.addEventListener('popstate', function () { setTimeout(send, 0); });
})();
