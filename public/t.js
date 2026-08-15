/* RunButter analytics — cookieless, ~2KB. Usage:
   <script defer src="https://runbutter.app/t.js" data-site="YOUR_SITE_ID"></script>

   Custom events, for goals and funnels:
     runbutter('Signup')
     runbutter('Plan chosen', { plan: 'team' })

   Optional extras, off unless asked for — each one costs a listener and most
   sites want none of them:
     data-outbound="true"   a click to another domain sends "Outbound link"
     data-downloads="true"  a click to a document sends "File download"
     data-404="true"        a page whose <title> looks like a 404 sends "404"

   Deliberately NOT automatic. A tracker that quietly instruments every click on
   somebody else's page is the behaviour this whole pipeline exists to avoid, and
   an event nobody asked for still costs a row and a decision about consent. */
(function () {
  var s = document.currentScript;
  if (!s) return;
  var site = s.getAttribute('data-site');
  if (!site) return;
  var api = s.getAttribute('data-api') || new URL(s.src).origin + '/api/t';
  var on = function (a) { return s.getAttribute(a) === 'true'; };
  var last = '';

  function post(body) {
    try {
      var j = JSON.stringify(body);
      if (navigator.sendBeacon) navigator.sendBeacon(api, j);
      else fetch(api, { method: 'POST', body: j, keepalive: true });
    } catch (e) { /* never break the host page */ }
  }

  function base() {
    // Campaign params are read from the URL that is CURRENTLY in the address
    // bar, so an SPA navigation away from the tagged landing URL stops
    // attributing — the first view carries the campaign, later ones don't.
    var q = new URLSearchParams(location.search);
    return {
      s: site,
      p: location.pathname || '/',
      r: document.referrer || '',
      w: window.innerWidth || 0,
      utm_source: q.get('utm_source') || '',
      utm_medium: q.get('utm_medium') || '',
      utm_campaign: q.get('utm_campaign') || '',
    };
  }

  function send() {
    var p = location.pathname || '/';
    if (p === last) return; // dedupe SPA double-fires
    last = p;
    post(base());
  }

  /* The public API. Named events go in the same shape as a pageview, with `n`
     set — one endpoint, one row type, so a goal can match either. */
  function track(name, props) {
    if (!name || name === 'pageview') return;
    var b = base();
    b.n = String(name).slice(0, 60);
    if (props && typeof props === 'object') b.d = props;
    post(b);
  }
  window.runbutter = track;
  // Queue support: a site can call runbutter() before this file loads if it
  // defines `window.runbutter = function(){ (runbutter.q = runbutter.q || []).push(arguments) }`.
  var q = (window.runbutter && window.runbutter.q) || [];
  for (var i = 0; i < q.length; i++) track.apply(null, q[i]);

  // initial view + SPA navigations
  send();
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); setTimeout(send, 0); };
  window.addEventListener('popstate', function () { setTimeout(send, 0); });

  var DOC = /\.(pdf|zip|rar|7z|csv|xlsx?|docx?|pptx?|dmg|exe|pkg|mp3|mp4|wav|mov)$/i;

  if (on('data-outbound') || on('data-downloads')) {
    // One listener in the CAPTURE phase, so it still fires when the page's own
    // handler calls stopPropagation — which most single-page routers do.
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || !a.href) return;
      var u;
      try { u = new URL(a.href, location.href); } catch (x) { return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (on('data-downloads') && DOC.test(u.pathname)) {
        track('File download', { url: u.href });
      } else if (on('data-outbound') && u.hostname !== location.hostname) {
        track('Outbound link', { url: u.href });
      }
    }, true);
  }

  if (on('data-404')) {
    // There is no way to read a status code from JavaScript, so this is a
    // heuristic on the title and it is documented as one rather than presented
    // as a fact. A site that wants certainty calls runbutter('404') from its own
    // error page, which is one line and always right.
    if (/(^|\D)404(\D|$)|not found/i.test(document.title || '')) {
      track('404', { path: location.pathname });
    }
  }
})();
