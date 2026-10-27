// =====================================================================
// SHARED HELPERS  (script/common.js)
// ---------------------------------------------------------------------
// Used by BOTH pages:
//   index.html   main menu + loading screen
//   game.html    the 3D game
//
// Exports
//   CHARACTER_PATHS               FBX files the game needs (single source
//                                 of truth: the menu preloads them, the
//                                 game loads them via CONFIG.paths)
//   isTouchDevice / isMobileDevice / isHandheldDevice
//   isLandscapeOrientation()      true when the screen is landscape. Desktop
//                                 windows always count as landscape (a
//                                 desktop has nothing to rotate).
//   fullscreenApiAvailable()      false on iPhone Safari AND in WebViews /
//                                 in-app browsers that report fullscreen as
//                                 disabled, so those are never blocked
//   isFullscreenActive()          this page, or the page embedding it, is
//                                 fullscreen (or an installed app)
//   isFullscreenSatisfied()       fullscreen rule is met, not possible, or
//                                 the browser refused it several times
//   getRotateHint()               device-aware "how to rotate" sentence
//   watchViewportState(fn)        calls fn on every orientation / resize /
//                                 fullscreen change, plus delayed re-checks
//                                 (iOS and Android report the new size late)
//   requestFullscreenLandscape()  enter fullscreen + lock landscape. MUST run
//                                 inside a user gesture (click / tap / key).
//                                 Safe to call many times: one request runs
//                                 at a time.
//   setupStartGate(onPass)        "rotate your device" screen (icon + text only),
//                                 shown until fullscreen + landscape, then calls
//                                 onPass(). Touching the screen rotates / goes
//                                 fullscreen by itself where the browser allows.
//   setupMobileFullscreen(fn)     automatic fullscreen + landscape lock;
//                                 fn is called after the viewport changes
//
// Loaded as an ES module:
//   import { CHARACTER_PATHS } from './script/common.js';
// =====================================================================

/* Paths are relative to the page that uses them (index.html and
   game.html sit in the same folder, next to ./character/). */
export const CHARACTER_PATHS = {
  idle:    './character/idle.fbx',
  run:     './character/run.fbx',
  jump:    './character/jump.fbx',
  pickup:  './character/pickUp.fbx',
  back:    './character/back.fbx',
  slipper: './character/slipper.fbx',
  throw:   './character/throw.fbx',
};

export const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

export const isMobileDevice =
  isTouchDevice || /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);

/* A phone or tablet (something you can physically rotate). A touch-screen
   laptop is NOT handheld: its primary pointer is not "coarse". iPadOS
   reports itself as a Mac, so it is detected by its touch points. */
export const isHandheldDevice = (function () {
  try {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (err) {
    return isTouchDevice;
  }
})();

/* =====================================================================
   FULLSCREEN + LANDSCAPE  (the "play only in fullscreen landscape" rule)
   ---------------------------------------------------------------------
   BROWSER RULES THIS CODE HAS TO WORK WITH
     1. requestFullscreen() is refused unless it runs inside a real user
        gesture. Only click / touchend / pointerup / keydown / mousedown
        count; touchstart and (touch) pointerdown do NOT. So fullscreen can
        never be forced on page load: it has to ride on a tap the player
        makes anyway (the PLAY button, or a tap on a gate screen).
     2. screen.orientation.lock() only works while the page is fullscreen
        (and not at all on iPhone Safari). Where it cannot work, the player
        has to turn the phone by hand, and the gate says so honestly.
     3. Fullscreen and the lock are dropped on page navigation, Esc and
        system gestures. That is why the game runs inside index.html's
        iframe, and why game.html keeps a PLAY GATE that blocks play until
        both conditions are true again.
     4. Where the browser offers no usable Fullscreen API (iPhone Safari,
        Android WebViews, in-app browsers) the page can only ask for
        landscape. Added to the Home Screen it runs as a standalone app,
        which counts as fullscreen here.
     5. If a browser keeps refusing fullscreen after several real taps, the
        gate stops insisting on it (landscape is still required) so the
        player is never stuck on a screen they cannot get past.
   ===================================================================== */
const isEmbeddedFrame = (function () {
  try { return window.self !== window.top; } catch (err) { return true; }
})();

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* Polls test() every 50 ms for up to maxMs. Resolves to test()'s last value. */
async function waitUntil(test, maxMs) {
  const STEP = 50;
  for (let t = 0; t < maxMs; t += STEP) {
    if (test()) return true;
    await wait(STEP);
  }
  return !!test();
}

/* Installed / home-screen app, or the browser is already in display-mode
   fullscreen (this also covers F11 on desktop). */
function isStandaloneApp() {
  try {
    return !!(window.navigator.standalone ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches);
  } catch (err) {
    return false;
  }
}

function getFullscreenRequestFn(el) {
  return el.requestFullscreen || el.webkitRequestFullscreen ||
         el.webkitRequestFullScreen || el.mozRequestFullScreen ||
         el.msRequestFullscreen || null;
}

function docIsFullscreen(doc) {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement ||
            doc.webkitCurrentFullScreenElement || doc.mozFullScreenElement ||
            doc.msFullscreenElement);
}

/* True only when fullscreen can really be entered. Some in-app browsers and
   Android WebViews define requestFullscreen but report the API as disabled;
   treating those as "available" would trap the player on the gate forever. */
export function fullscreenApiAvailable() {
  const el = document.documentElement;
  if (!getFullscreenRequestFn(el)) return false;

  let enabled;
  if (document.fullscreenEnabled !== undefined) enabled = document.fullscreenEnabled;
  else if (document.webkitFullscreenEnabled !== undefined) enabled = document.webkitFullscreenEnabled;
  else if (document.mozFullScreenEnabled !== undefined) enabled = document.mozFullScreenEnabled;
  if (enabled === false) return false;

  return true;
}

/* True when this page, or the page that embeds it, is fullscreen. */
export function isFullscreenActive() {
  if (isStandaloneApp()) return true;
  if (docIsFullscreen(document)) return true;
  try {
    if (isEmbeddedFrame && window.top.document && docIsFullscreen(window.top.document)) {
      return true;
    }
  } catch (err) { /* cross-origin parent: cannot inspect it */ }
  return false;
}

/* ---- "The browser keeps refusing fullscreen" fallback ----------------
   Stored in sessionStorage so index.html and the game iframe (same origin)
   agree, and so a later page load can try again. */
const GAVE_UP_KEY = 'toon-fullscreen-gave-up';
const MAX_FULLSCREEN_FAILURES = 3;
let _gaveUpMemory = false;
let _failCount = 0;
let _lastFailAt = 0;

function hasGivenUpFullscreen() {
  if (_gaveUpMemory) return true;
  try {
    if (sessionStorage.getItem(GAVE_UP_KEY) === '1') {
      _gaveUpMemory = true;
      return true;
    }
  } catch (err) { /* storage blocked */ }
  return false;
}

function setFullscreenGaveUp() {
  _gaveUpMemory = true;
  try { sessionStorage.setItem(GAVE_UP_KEY, '1'); } catch (err) { /* ignore */ }
}

/* Called once per real tap on a gate screen, after the request finished. */
function noteFullscreenResult(ok) {
  if (ok) { _failCount = 0; return; }
  if (!fullscreenApiAvailable()) return;

  /* One physical tap can raise several events (touchend + click): count
     at most one failure per 600 ms. */
  const now = Date.now();
  if (now - _lastFailAt < 600) return;
  _lastFailAt = now;

  _failCount++;
  if (_failCount >= MAX_FULLSCREEN_FAILURES) {
    setFullscreenGaveUp();
    console.warn('Fullscreen is blocked in this browser: continuing without it.');
  }
}

/* The fullscreen half of the rule is met when: the browser cannot do
   fullscreen at all, OR it is fullscreen / an installed app, OR it refused
   several real taps in a row. */
export function isFullscreenSatisfied() {
  return !fullscreenApiAvailable() || isFullscreenActive() || hasGivenUpFullscreen();
}

/* ---- Orientation ----------------------------------------------------- */
export function isLandscapeOrientation() {
  /* A desktop window has no "rotate": never block it for being tall. */
  if (!isHandheldDevice) return true;

  /* The window shape is what the game really draws into, and it is the
     value every browser updates last, so callers re-check after a delay. */
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  const h = window.innerHeight || document.documentElement.clientHeight || 0;
  if (w > 0 && h > 0) return w >= h;

  try { return window.matchMedia('(orientation: landscape)').matches; }
  catch (err) { return true; }
}

/* Can a tap rotate the screen by itself? Only where fullscreen AND the
   orientation lock both exist (Chrome / Firefox / Samsung on Android). */
function canAutoRotate() {
  try {
    return fullscreenApiAvailable() &&
      !!(screen.orientation && typeof screen.orientation.lock === 'function');
  } catch (err) {
    return false;
  }
}

/* One honest sentence about how to get to landscape on THIS device. */
export function getRotateHint() {
  if (canAutoRotate()) {
    return 'Touch the screen and it rotates automatically. If it does not, turn your phone sideways.';
  }
  return "Turn your phone sideways. If the screen does not turn, switch off your phone's rotation lock.";
}

/* Calls callback() on every event that can change orientation, window size
   or fullscreen state, then again 120 / 350 / 800 / 1600 ms later. Browsers
   fire these events BEFORE the new size is available (iOS Safari is the
   worst), so the delayed re-checks are what make rotation reliable.
   Returns a function that stops watching. */
export function watchViewportState(callback) {
  let stopped = false;
  let timers = [];
  const cleanups = [];

  function run() {
    if (stopped) return;
    try { callback(); } catch (err) { console.warn('viewport watcher failed:', err); }
  }
  function runNowAndLater() {
    run();
    for (const id of timers) clearTimeout(id);
    timers = [120, 350, 800, 1600].map(function (ms) { return setTimeout(run, ms); });
  }
  function listen(target, evt) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(evt, runNowAndLater);
    cleanups.push(function () { target.removeEventListener(evt, runNowAndLater); });
  }

  const EVENTS = [
    'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange',
    'MSFullscreenChange', 'orientationchange', 'resize', 'pageshow',
    'visibilitychange',
  ];
  for (const evt of EVENTS) {
    listen(window, evt);
    listen(document, evt);
  }
  listen(window.visualViewport, 'resize');

  try { listen(screen.orientation, 'change'); } catch (err) { /* not supported */ }

  try {
    const mq = window.matchMedia('(orientation: landscape)');
    if (typeof mq.addEventListener === 'function') {
      listen(mq, 'change');
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(runNowAndLater);
      cleanups.push(function () { mq.removeListener(runNowAndLater); });
    }
  } catch (err) { /* not supported */ }

  return function stop() {
    stopped = true;
    for (const id of timers) clearTimeout(id);
    for (const fn of cleanups) fn();
  };
}

/* ---- Fullscreen + lock building blocks -------------------------------- */

/* Request fullscreen on THIS document. Never throws. */
async function enterFullscreenHere() {
  try {
    if (isFullscreenActive()) return;
    const el = document.documentElement;
    const req = getFullscreenRequestFn(el);
    if (!req) return;

    const p = req.call(el, { navigationUI: 'hide' });
    if (p && typeof p.then === 'function') {
      await p.catch(function () {});
    } else {
      /* Old WebKit: no promise, the state changes a moment later. */
      await waitUntil(isFullscreenActive, 400);
    }
  } catch (err) { /* blocked: the next tap tries again */ }
}

/* Lock to landscape. Only succeeds while fullscreen is active (or in an
   installed app). Never throws. Resolves to true when the lock was granted. */
async function lockLandscape() {
  try {
    const so = screen.orientation;
    if (so && typeof so.lock === 'function') {
      try { await so.lock('landscape'); return true; }
      catch (err) { return false; }
    }
    const legacy = screen.lockOrientation || screen.mozLockOrientation ||
                   screen.msLockOrientation;
    if (typeof legacy === 'function') return !!legacy.call(screen, 'landscape');
  } catch (err) { /* not supported on this browser */ }
  return false;
}

/* Inside index.html's iframe the TOP page owns fullscreen and the landscape
   lock. Call its function directly (same call stack as the tap, which is the
   most reliable way to keep the user gesture alive); fall back to a message
   if the parent is not reachable. */
function delegateFullscreenToParent() {
  try {
    const fn = window.parent && window.parent.__TOON_REQUEST_FULLSCREEN__;
    if (typeof fn === 'function') {
      const p = fn();
      if (p && typeof p.catch === 'function') p.catch(function () {});
      return;
    }
  } catch (err) { /* cross-origin parent: use a message instead */ }

  try {
    window.parent.postMessage({ type: 'toon:request-fullscreen' }, '*');
  } catch (err) { /* ignore */ }
}

async function doRequestFullscreenLandscape() {
  const apiOk = fullscreenApiAvailable();

  if (isEmbeddedFrame) {
    delegateFullscreenToParent();
    if (apiOk) await waitUntil(isFullscreenActive, 800);
    if (apiOk && !isFullscreenActive()) {
      /* Last resort: ask from this frame (the iframe has allow="fullscreen"). */
      await enterFullscreenHere();
      await lockLandscape();
    }
  } else {
    /* The fullscreen request runs synchronously inside the gesture: this
       whole function body executes up to its first await right away. */
    if (apiOk) await enterFullscreenHere();
    await lockLandscape();
  }

  return isFullscreenActive();
}

let _fsInflight = null;

/* Enter fullscreen, then lock to landscape. Call it straight from a click /
   tap / key handler. Only ONE request runs at a time: a tap raises several
   events (touchend, pointerup, click) and each of them used to start its own
   request and orientation lock, which made browsers abort each other.
   Resolves to true when fullscreen is on afterwards; never rejects.

   opts.fromGate = true marks a tap on a gate screen: if the browser keeps
   refusing, the gate eventually stops insisting on fullscreen. */
export function requestFullscreenLandscape(opts) {
  if (!_fsInflight) {
    _fsInflight = doRequestFullscreenLandscape().then(
      function (ok) { _fsInflight = null; return ok; },
      function () { _fsInflight = null; return isFullscreenActive(); }
    );
  }
  const flight = _fsInflight;
  if (opts && opts.fromGate) {
    flight.then(function (ok) { noteFullscreenResult(ok); });
  }
  return flight;
}

/* The top page exposes the request so the game iframe can call it directly
   (see delegateFullscreenToParent). */
if (!isEmbeddedFrame) {
  window.__TOON_REQUEST_FULLSCREEN__ = function () {
    return requestFullscreenLandscape();
  };
}

/* =====================================================================
   START GATE  (rotate your device + fullscreen, before anything starts)
   ---------------------------------------------------------------------
   The page shows ONLY the "Rotate your device" screen (icon, title and
   text; no buttons, no menu) until it is fullscreen AND landscape. Then
   the screen fades out and onPass() runs, so loading / the main menu start
   only after that.

   Touching the screen anywhere is the user gesture the browser demands, so
   the touch itself does the work: fullscreen is requested and the screen is
   locked to landscape, i.e. the page rotates automatically (Android). On
   iPhone no browser can do that, so the text asks the player to turn the
   phone by hand. Turning the phone sideways works everywhere.

   Desktop windows are never asked to rotate. Browsers that refuse
   fullscreen are let through once landscape is true (see
   isFullscreenSatisfied).

   Shown once per page load. The game's own play gate (game.html) keeps
   guarding gameplay afterwards.
   ===================================================================== */
export function setupStartGate(onPass) {
  const finish = (typeof onPass === 'function') ? onPass : function () {};
  const overlay = document.getElementById('rotate-overlay');
  if (!overlay) { finish(); return; }

  const titleEl = document.getElementById('rotate-title');
  const textEl = document.getElementById('rotate-text');
  let done = false;
  let taps = 0;
  let lastTapAt = 0;
  let pollId = 0;
  let stopWatching = function () {};

  function isReady() {
    return isLandscapeOrientation() && isFullscreenSatisfied();
  }

  /* Already fullscreen + landscape (installed app, F11, desktop, ...). */
  if (isReady()) { finish(); return; }

  function paint() {
    if (!titleEl || !textEl) return;
    if (!isLandscapeOrientation()) {
      titleEl.textContent = 'Rotate your device';
      textEl.textContent =
        'This game plays only in FULLSCREEN LANDSCAPE. ' + getRotateHint();
    } else {
      titleEl.textContent = 'Enter fullscreen';
      textEl.textContent = (taps > 0)
        ? 'Your browser blocked fullscreen. Touch the screen to try again.'
        : 'This game plays only in FULLSCREEN LANDSCAPE. Touch the screen to go fullscreen.';
    }
  }

  function check() {
    if (done) return;
    if (!isReady()) { paint(); return; }
    done = true;

    clearInterval(pollId);
    stopWatching();
    overlay.removeEventListener('click', onTap);
    overlay.removeEventListener('touchend', onTap);

    overlay.classList.add('closing');
    setTimeout(function () { overlay.classList.remove('show', 'closing'); }, 300);
    finish();
  }

  /* The touch IS the user gesture: go fullscreen + lock landscape right here. */
  function onTap(e) {
    if (e && e.cancelable) e.preventDefault();

    /* touchend and the click that follows it are the same tap. */
    const now = Date.now();
    if (now - lastTapAt < 350) return;
    lastTapAt = now;

    taps++;
    requestFullscreenLandscape({ fromGate: true }).then(check, check);
    /* The orientation lock often settles a moment after fullscreen. */
    setTimeout(check, 200);
    setTimeout(check, 500);
  }

  paint();
  overlay.classList.add('show');
  overlay.addEventListener('click', onTap);
  overlay.addEventListener('touchend', onTap, { passive: false });

  /* Orientation / resize / fullscreen events, each followed by delayed
     re-checks, plus a slow poll for browsers that fire nothing at all. */
  stopWatching = watchViewportState(check);
  pollId = setInterval(check, 400);
}

/* =====================================================================
   MOBILE FULLSCREEN + LANDSCAPE LOCK  (automatic, no dedicated tap)
   ---------------------------------------------------------------------
   Browsers require a user gesture for Fullscreen + Orientation Lock.
   To make this feel automatic:
     1. We attempt it IMMEDIATELY on load (works if the page was opened
        from a user gesture, e.g. tapping a link).
     2. We listen to EVERY user-interaction event (touch, pointer, mouse,
        key, wheel, scroll, focus, visibilitychange) and re-attempt on
        each one until it succeeds. The first gesture the user makes
        will trigger it.
     3. A slow interval retry (every 400ms) handles the case where the
        browser becomes "ready" a moment after load.
   Only one attempt runs at a time, so a burst of events cannot stack up
   dozens of overlapping fullscreen / lock requests.
   Does nothing on desktop browsers.
   ===================================================================== */
export function setupMobileFullscreen(onResize) {
  if (!isMobileDevice) return;

  const resize = (typeof onResize === 'function') ? onResize : function () {};
  let fullscreenKicked = false;
  let busy = false;

  async function enterFullscreenLandscape(force) {
    if (!force && fullscreenKicked) return;
    if (busy && !force) return;

    /* When forced (iframe gesture after the browser silently dropped
       fullscreen / orientation lock while the app was backgrounded, or
       on app resume while the cached success flag is still stale),
       clear the flag so the retry actually runs even if no
       fullscreenchange event ever fired. */
    if (force) fullscreenKicked = false;

    busy = true;
    try {
      await enterFullscreenHere();
      await lockLandscape();

      /* "Done" means FULLSCREEN is really on (checked, not assumed: old
         WebKit's request returns no promise), or the browser has no usable
         Fullscreen API at all (iPhone Safari, WebViews). A missing
         orientation-lock API must NOT count as done. */
      if (isFullscreenActive() || !fullscreenApiAvailable()) fullscreenKicked = true;
    } finally {
      busy = false;
    }

    resize();
  }

  /* Expose so an embedded same-origin game iframe can ask the parent
     to re-enter fullscreen after the user has left it. Iframe gestures
     never reach this document's own kick listeners, so the child page
     forwards them here. The exposed wrapper forces the retry so a
     silently-dropped fullscreen is always re-requested on the next
     in-game touch, even if the cached success flag is still set. */
  window.__TOON_ENTER_FULLSCREEN__ = () => enterFullscreenLandscape(true);

  /* 1. Immediate attempt: works if launched from a user gesture. */
  enterFullscreenLandscape();

  /* 2. Retry on the FIRST interaction of any kind. Every event is
        passive + capture-phase so it can never block the app. */
  const kick = () => { if (!fullscreenKicked) enterFullscreenLandscape(); };
  const KICK_EVENTS = [
    'touchstart', 'touchend', 'touchmove',
    'pointerdown', 'pointerup', 'pointermove',
    'mousedown', 'mouseup', 'click',
    'keydown', 'keyup',
    'wheel', 'scroll',
    'focus', 'visibilitychange',
  ];
  for (const evt of KICK_EVENTS) {
    window.addEventListener(evt, kick, { passive: true, capture: true });
    document.addEventListener(evt, kick, { passive: true, capture: true });
  }

  /* 3. Slow retry loop: covers browsers that need a moment. */
  let tries = 0;
  const retryId = setInterval(() => {
    if (fullscreenKicked || ++tries > 40) { clearInterval(retryId); return; }
    enterFullscreenLandscape();
  }, 400);

  /* Re-arm the kick whenever we lose fullscreen. */
  const onFsChange = () => {
    if (!docIsFullscreen(document)) {
      fullscreenKicked = false;
      window.dispatchEvent(new Event('toon:lost-fullscreen'));
    }
    setTimeout(resize, 60);
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('mozfullscreenchange', onFsChange);
  document.addEventListener('MSFullscreenChange', onFsChange);
}