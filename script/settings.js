// =====================================================================
// TOON-STYLE MENU  (script/settings.js)
// ---------------------------------------------------------------------
// FLOW
//   1. A cartoon gear icon sits in the top-right corner.
//   2. Tap it  ->  the game background blurs and ONLY the menu buttons show:
//        - SETTINGS        (opens the settings card)
//        - MAIN MENU       (goes back to index.html, the main menu)
//   3. SETTINGS shows:
//        - Debug Overlay switch (shows / hides the #hud text)
//        - Bird View switch (fixed overhead camera <-> third-person)
//        - Look Sensitivity sliders (horizontal + vertical)
//        - RESET LOOK button
//      The arrow button goes back to the two-button menu.
//   4. Tap the gear again, tap the blurred background, or press Esc to close.
//
// HOOKS INTO THE GAME
//   - window.LOOK_SENSITIVITY = { x, y }   read by CameraController.rotate()
//
// Settings are remembered in localStorage (wrapped in try/catch).
// =====================================================================
(function () {
  'use strict';

  if (document.getElementById('toon-settings-btn')) return; // already built

  // ------------------------------------------------------------------
  // 0. State (load / save)
  // ------------------------------------------------------------------
  var STORAGE_KEY = 'toon-settings-v1';
  /* Slider now runs 1x (min / current default feel) up to 100x (max). */
  var SENS_MIN = 1;
  var SENS_MAX = 100;
  var SENS_STEP = 1;
  var SENS_DEFAULT = 1;

  function clampSens(v) {
    v = Number(v);
    if (!isFinite(v)) return SENS_DEFAULT;
    v = Math.min(SENS_MAX, Math.max(SENS_MIN, v));
    return Math.round(v);
  }

  var saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch (err) {
    saved = {};
  }

  var settings = {
    debug: saved.debug !== false,
    lookX: clampSens(saved.lookX === undefined ? SENS_DEFAULT : saved.lookX),
    lookY: clampSens(saved.lookY === undefined ? SENS_DEFAULT : saved.lookY)
  };

  /* Slider values stay 1..100, but the ACTUAL camera-look multiplier
     is mapped linearly from 1x (slider = 1) up to MULTIPLIER_MAX
     (slider = 100). So slider 100 == 8x camera speed, not 100x. */
  var MULTIPLIER_MAX = 8;

  function sliderToMultiplier(v) {
    v = clampSens(v);
    return 1 + (v - 1) * (MULTIPLIER_MAX - 1) / (SENS_MAX - SENS_MIN);
  }

  function applySensitivity() {
    window.LOOK_SENSITIVITY = {
      x: sliderToMultiplier(settings.lookX),
      y: sliderToMultiplier(settings.lookY)
    };
  }
  applySensitivity();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) { /* ignore */ }
  }

  // ------------------------------------------------------------------
  // 1. Styles
  // ------------------------------------------------------------------
  var styleEl = document.createElement('style');
  styleEl.id = 'toon-settings-styles';
  styleEl.textContent = `
    @keyframes toon-pop {
      from { opacity: 0; transform: scale(0.7) translateY(18px); }
      to   { opacity: 1; transform: none; }
    }

    /* ---------- Gear button (stays above the blur) ----------
       Just the gear glyph — no circular badge or drop shadow ring,
       so the icon reads cleanly at a small size. */
    #toon-settings-btn {
      position: fixed;
      top: max(10px, env(safe-area-inset-top));
      right: max(10px, env(safe-area-inset-right));
      width: 34px;
      height: 34px;
      box-sizing: border-box;
      padding: 0;
      margin: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 400; /* above #rotate-overlay (300) and the play gate (90) */
      pointer-events: auto;
      opacity: 0.92;
      filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.55));
      transition: transform 0.15s ease, opacity 0.15s ease;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      user-select: none;
      -webkit-user-select: none;
    }
    #toon-settings-btn .toon-gear {
      width: 26px;
      height: 26px;
      display: block;
      pointer-events: none;
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @media (hover: hover) {
      #toon-settings-btn:hover {
        opacity: 1;
        transform: scale(1.06);
      }
      #toon-settings-btn:hover .toon-gear {
        transform: rotate(-15deg);
      }
    }
    #toon-settings-btn:active {
      opacity: 0.7;
      transform: scale(0.9);
    }
    #toon-settings-btn.is-open .toon-gear {
      transform: rotate(135deg);
    }

    /* ---------- Blurred full-screen overlay ---------- */
    #toon-menu-overlay {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 399; /* just under the gear, above #rotate-overlay (300) */
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      background: rgba(16, 24, 48, 0.38);
      -webkit-backdrop-filter: blur(0px);
      backdrop-filter: blur(0px);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      color: #000;
      font-family: "Arial Rounded MT Bold", "Trebuchet MS", "Comic Sans MS", "Chalkboard SE", Arial, sans-serif;
      -webkit-user-select: none;
      user-select: none;
      transition:
        opacity 0.2s ease,
        -webkit-backdrop-filter 0.25s ease,
        backdrop-filter 0.25s ease,
        visibility 0s linear 0.25s;
    }
    #toon-menu-overlay.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
      transition:
        opacity 0.2s ease,
        -webkit-backdrop-filter 0.25s ease,
        backdrop-filter 0.25s ease,
        visibility 0s;
    }

    .toon-view { display: none; }
    #toon-menu-overlay[data-view="menu"] #toon-view-menu { display: flex; }
    #toon-menu-overlay[data-view="settings"] #toon-view-settings { display: flex; }

    /* ---------- Two-button menu ---------- */
    #toon-view-menu {
      flex-direction: column;
      align-items: center;
      gap: 20px;
      pointer-events: none; /* gaps between buttons count as "background" */
    }
    .toon-menu-btn {
      position: relative;
      width: 240px;
      max-width: calc(100vw - 48px);
      box-sizing: border-box;
      padding: 12px 16px 14px;
      border: 3px solid #000;
      border-radius: 16px;
      color: #fff;
      font-family: inherit;
      font-size: 17px;
      font-weight: 900;
      letter-spacing: 0.06em;
      text-shadow:
        1.5px 0 0 #000, -1.5px 0 0 #000, 0 1.5px 0 #000, 0 -1.5px 0 #000,
        1.5px 1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px -1.5px 0 #000,
        0 3px 0 #000;
      cursor: pointer;
      pointer-events: auto;
      box-shadow:
        0 5px 0 #000,
        inset 0 -5px 0 rgba(0, 0, 0, 0.2),
        inset 0 4px 0 rgba(255, 255, 255, 0.4);
      transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.15s ease;
      animation: toon-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    @media (hover: hover) {
      .toon-menu-btn:hover { transform: translateY(-2px) scale(1.02); }
    }
    .toon-menu-btn:active {
      transform: translateY(4px);
      box-shadow:
        0 1px 0 #000,
        inset 0 -3px 0 rgba(0, 0, 0, 0.2),
        inset 0 4px 0 rgba(255, 255, 255, 0.4);
    }
    #toon-btn-settings { background: #8f6bff; }
    #toon-btn-refresh { background: #ff9f1c; animation-delay: 0.07s; }
    #toon-btn-home { background: #2fc4d6; animation-delay: 0.14s; }

    /* ---------- Settings card ---------- */
    #toon-view-settings {
      flex-direction: column;
      width: 260px;
      max-width: 100%;
      max-height: 100%;
      box-sizing: border-box;
      background: #fff3c4;
      border: 3px solid #000;
      border-radius: 16px;
      box-shadow: 4px 5px 0 #000;
      overflow: hidden;
      animation: toon-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    }
    .toon-head {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: #ff9f1c;
      border-bottom: 3px solid #000;
    }
    .toon-head-spacer { width: 26px; height: 26px; }
    .toon-title {
      margin: 0;
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.06em;
      color: #fff;
      text-shadow:
        1.5px 0 0 #000, -1.5px 0 0 #000, 0 1.5px 0 #000, 0 -1.5px 0 #000,
        1.5px 1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px -1.5px 0 #000,
        0 3px 0 #000;
    }
    .toon-back {
      width: 26px;
      height: 26px;
      box-sizing: border-box;
      padding: 0;
      border: 2px solid #000;
      border-radius: 50%;
      background: #fff;
      color: #000;
      font-family: inherit;
      font-size: 14px;
      font-weight: 900;
      line-height: 1;
      cursor: pointer;
      box-shadow: 0 2px 0 #000, inset 0 2px 0 rgba(255, 255, 255, 0.35);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .toon-back:active {
      transform: translateY(1px);
      box-shadow: 0 1px 0 #000;
    }

    /* Scrolls on short (landscape phone) screens. */
    .toon-body {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 10px;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      touch-action: pan-y;
    }
    .toon-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 9px;
      background: #fff;
      border: 2px solid #000;
      border-radius: 10px;
      box-shadow: 0 2px 0 #000;
    }
    .toon-row-col {
      flex-direction: column;
      align-items: stretch;
      gap: 0;
      padding-bottom: 9px;
    }
    .toon-row-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .toon-row-text { display: block; min-width: 0; }
    .toon-row-label {
      display: block;
      font-size: 12px;
      font-weight: 900;
      line-height: 1.1;
    }
    .toon-row-hint {
      display: block;
      margin-top: 2px;
      font-size: 10px;
      font-weight: 700;
      line-height: 1.2;
      color: #7a6320;
    }
    .toon-section {
      align-self: flex-start;
      margin: 1px 0 -3px;
      padding: 2px 9px;
      background: #000;
      color: #fff3c4;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
    }
    .toon-value {
      min-width: 42px;
      box-sizing: border-box;
      padding: 1px 6px;
      border: 2px solid #000;
      border-radius: 999px;
      background: #ffb21f;
      text-align: center;
      font-size: 10px;
      font-weight: 900;
      line-height: 13px;
      box-shadow: 0 1px 0 #000;
    }

    /* ---------- On / off switch ---------- */
    .toon-switch {
      position: relative;
      flex: 0 0 auto;
      width: 62px;
      height: 30px;
      box-sizing: border-box;
      padding: 0;
      border: 2px solid #000;
      border-radius: 999px;
      background: #ff5c6c;
      cursor: pointer;
      font-family: inherit;
      box-shadow:
        0 2px 0 #000,
        inset 0 -3px 0 rgba(0, 0, 0, 0.18),
        inset 0 2px 0 rgba(255, 255, 255, 0.35);
      transition: background 0.18s ease, transform 0.1s ease, box-shadow 0.1s ease;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .toon-switch.on { background: #5fd35f; }
    .toon-switch:active {
      transform: translateY(1px);
      box-shadow:
        0 1px 0 #000,
        inset 0 -3px 0 rgba(0, 0, 0, 0.18),
        inset 0 2px 0 rgba(255, 255, 255, 0.35);
    }
    .toon-switch-knob {
      position: absolute;
      top: 50%;
      left: 2px;
      width: 20px;
      height: 20px;
      box-sizing: border-box;
      margin-top: -10px;
      border: 2px solid #000;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 0 #000;
      transition: left 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .toon-switch.on .toon-switch-knob { left: 36px; }
    .toon-switch-label {
      position: absolute;
      top: 50%;
      right: 7px;
      margin-top: -5px;
      font-size: 10px;
      line-height: 10px;
      font-weight: 900;
      letter-spacing: 0.03em;
      color: #000;
      pointer-events: none;
    }
    .toon-switch-label::before { content: 'OFF'; }
    .toon-switch.on .toon-switch-label { right: auto; left: 8px; }
    .toon-switch.on .toon-switch-label::before { content: 'ON'; }

    /* ---------- Sliders ---------- */
    .toon-slider {
      -webkit-appearance: none;
      appearance: none;
      display: block;
      width: 100%;
      height: 18px;
      margin: 8px 0 0;
      padding: 0;
      box-sizing: border-box;
      border: 2px solid #000;
      border-radius: 999px;
      background: linear-gradient(
        to right,
        #ffb21f 0,
        #ffb21f calc(11px + (100% - 22px) * var(--p, 0.5)),
        #fff calc(11px + (100% - 22px) * var(--p, 0.5)),
        #fff 100%
      );
      box-shadow: 0 2px 0 #000;
      cursor: pointer;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }
    .toon-slider::-webkit-slider-runnable-track {
      height: 100%;
      border: 0;
      background: transparent;
    }
    .toon-slider::-moz-range-track {
      height: 100%;
      border: 0;
      background: transparent;
    }
    .toon-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 22px;
      height: 22px;
      margin-top: -5px;
      box-sizing: border-box;
      border: 2px solid #000;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 0 #000;
    }
    .toon-slider::-moz-range-thumb {
      width: 22px;
      height: 22px;
      box-sizing: border-box;
      border: 2px solid #000;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 0 #000;
    }
    .toon-slider:active::-webkit-slider-thumb { background: #ffe9a3; }
    .toon-slider:active::-moz-range-thumb { background: #ffe9a3; }
    .toon-slider-range {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 5px;
      padding: 0 2px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.03em;
      color: #7a6320;
    }
    .toon-slider-range span {
      display: inline-block;
      padding: 1px 6px;
      background: #000;
      color: #fff3c4;
      border-radius: 999px;
    }

    /* ---------- Reset button ---------- */
    .toon-reset {
      flex: 0 0 auto;
      padding: 7px 10px;
      border: 2px solid #000;
      border-radius: 10px;
      background: #fff;
      color: #000;
      font-family: inherit;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      cursor: pointer;
      box-shadow: 0 2px 0 #000, inset 0 -3px 0 rgba(0, 0, 0, 0.12);
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .toon-reset:active {
      transform: translateY(2px);
      box-shadow: 0 0 0 #000, inset 0 -3px 0 rgba(0, 0, 0, 0.12);
    }

    #toon-settings-btn:focus-visible,
    .toon-menu-btn:focus-visible,
    .toon-back:focus-visible,
    .toon-switch:focus-visible,
    .toon-reset:focus-visible,
    .toon-slider:focus-visible {
      outline: 3px dashed #fff;
      outline-offset: 3px;
    }

    /* ---------- Narrow windows: keep clear of the gear ---------- */
    @media (max-width: 480px) {
      #toon-menu-overlay { padding-top: 58px; }
    }

    /* ---------- Short landscape phones ---------- */
    @media (max-height: 480px) {
      #toon-settings-btn { width: 30px; height: 30px; }
      #toon-settings-btn .toon-gear { width: 22px; height: 22px; }
      #toon-view-menu { gap: 12px; }
      .toon-menu-btn {
        width: 220px;
        padding: 9px 14px 11px;
        font-size: 15px;
      }
      #toon-view-settings { width: 240px; }
      .toon-head { padding: 5px 8px; }
      .toon-title { font-size: 13px; }
      .toon-body { gap: 7px; padding: 8px; }
      .toon-row { padding: 6px 8px; }
      .toon-row-col { padding-bottom: 8px; }
      .toon-slider { margin-top: 6px; }
    }
  `;
  /* Shared gear + back button design (matches the lobby in index.html). */
  styleEl.textContent += `
    #toon-settings-btn {
      top: max(12px, env(safe-area-inset-top));
      right: max(12px, env(safe-area-inset-right));
      width: 46px;
      height: 46px;
      border: 3px solid #000;
      border-radius: 50%;
      background: #ff9f1c;
      opacity: 1;
      filter: none;
      box-shadow:
        0 4px 0 #000,
        inset 0 -4px 0 rgba(0, 0, 0, 0.2),
        inset 0 3px 0 rgba(255, 255, 255, 0.45);
      transition: transform 0.1s ease, box-shadow 0.1s ease;
    }
    #toon-settings-btn .toon-gear {
      width: 28px;
      height: 28px;
    }
    @media (hover: hover) {
      #toon-settings-btn:hover {
        opacity: 1;
        transform: translateY(-2px);
      }
      #toon-settings-btn:hover .toon-gear {
        transform: rotate(-15deg);
      }
    }
    #toon-settings-btn:active {
      opacity: 1;
      transform: translateY(3px);
      box-shadow:
        0 1px 0 #000,
        inset 0 -3px 0 rgba(0, 0, 0, 0.2),
        inset 0 3px 0 rgba(255, 255, 255, 0.45);
    }
    #toon-settings-btn.is-open .toon-gear {
      transform: rotate(135deg);
    }
    @media (max-height: 480px) {
      #toon-settings-btn { width: 40px; height: 40px; }
      #toon-settings-btn .toon-gear { width: 24px; height: 24px; }
    }

    .toon-head-spacer { width: 32px; height: 32px; }
    .toon-back {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fff;
      box-shadow:
        0 3px 0 #000,
        inset 0 -3px 0 rgba(0, 0, 0, 0.15),
        inset 0 2px 0 rgba(255, 255, 255, 0.6);
      transition: transform 0.1s ease, box-shadow 0.1s ease;
    }
    .toon-back svg {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
    }
    @media (hover: hover) {
      .toon-back:hover { transform: translate(-1px, -1px); }
    }
    .toon-back:active {
      transform: translateY(2px);
      box-shadow:
        0 1px 0 #000,
        inset 0 -2px 0 rgba(0, 0, 0, 0.15),
        inset 0 2px 0 rgba(255, 255, 255, 0.6);
    }
  `;
  document.head.appendChild(styleEl);

  // ------------------------------------------------------------------
  // 2. Gear icon (generated, so no long hand-written path is needed)
  // ------------------------------------------------------------------
  function gearPath(cx, cy, teeth, rOuter, rInner, holeR) {
    var step = (Math.PI * 2) / teeth;
    var shape = [[-0.30, rInner], [-0.17, rOuter], [0.17, rOuter], [0.30, rInner]];
    var pts = [];
    for (var i = 0; i < teeth; i++) {
      var a = i * step - Math.PI / 2;
      for (var j = 0; j < shape.length; j++) {
        var ang = a + shape[j][0] * step;
        var r = shape[j][1];
        pts.push(
          (cx + Math.cos(ang) * r).toFixed(2) + ' ' +
          (cy + Math.sin(ang) * r).toFixed(2)
        );
      }
    }
    var hole =
      'M ' + (cx - holeR) + ' ' + cy +
      ' a ' + holeR + ' ' + holeR + ' 0 1 0 ' + (holeR * 2) + ' 0' +
      ' a ' + holeR + ' ' + holeR + ' 0 1 0 ' + (-holeR * 2) + ' 0 Z';
    return 'M ' + pts.join(' L ') + ' Z ' + hole;
  }

  var gearSvg =
    '<svg class="toon-gear" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="' + gearPath(16, 16, 8, 13, 9.6, 4) + '" ' +
    'fill="#fff3c4" fill-rule="evenodd" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/>' +
    '</svg>';

  // ------------------------------------------------------------------
  // 3. Build the gear button + overlay
  // ------------------------------------------------------------------
  var btn = document.createElement('button');
  btn.id = 'toon-settings-btn';
  btn.type = 'button';
  btn.title = 'Menu';
  btn.setAttribute('aria-label', 'Open menu');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = gearSvg;
  document.body.appendChild(btn);

  function sliderRowHtml(id, label) {
    return (
      '<div class="toon-row toon-row-col">' +
        '<div class="toon-row-top">' +
          '<label class="toon-row-label" for="' + id + '">' + label + '</label>' +
          '<span class="toon-value" id="' + id + '-val">1</span>' +
        '</div>' +
        '<input type="range" class="toon-slider" id="' + id + '" ' +
          'min="' + SENS_MIN + '" max="' + SENS_MAX + '" step="' + SENS_STEP + '" ' +
          'value="' + SENS_DEFAULT + '">' +
        '<div class="toon-slider-range">' +
          '<span>' + SENS_MIN + '</span>' +
          '<span>' + SENS_MAX + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  var overlay = document.createElement('div');
  overlay.id = 'toon-menu-overlay';
  overlay.setAttribute('data-view', 'menu');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML =
    '<div class="toon-view" id="toon-view-menu">' +
      '<button type="button" class="toon-menu-btn" id="toon-btn-settings">SETTINGS</button>' +
      '<button type="button" class="toon-menu-btn" id="toon-btn-refresh">REFRESH</button>' +
      '<button type="button" class="toon-menu-btn" id="toon-btn-home">MAIN MENU</button>' +
    '</div>' +
    '<div class="toon-view" id="toon-view-settings" role="dialog" aria-label="Settings">' +
      '<div class="toon-head">' +
        '<button type="button" class="toon-back" id="toon-back" aria-label="Back to menu">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 L8 12 L15 19" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<h3 class="toon-title">SETTINGS</h3>' +
        '<span class="toon-head-spacer"></span>' +
      '</div>' +
      '<div class="toon-body">' +
        '<div class="toon-row">' +
          '<div class="toon-row-text">' +
            '<span class="toon-row-label">Debug Overlay</span>' +
            '<span class="toon-row-hint">Controls &amp; state text</span>' +
          '</div>' +
          '<button type="button" class="toon-switch on" id="toon-switch-debug" ' +
            'role="switch" aria-checked="true" aria-label="Toggle debug overlay text">' +
            '<span class="toon-switch-knob"></span>' +
            '<span class="toon-switch-label"></span>' +
          '</button>' +
        '</div>' +
        '<div class="toon-row">' +
          '<div class="toon-row-text">' +
            '<span class="toon-row-label">Bird View</span>' +
            '<span class="toon-row-hint">Off: third-person camera</span>' +
          '</div>' +
          '<button type="button" class="toon-switch" id="toon-switch-camera" ' +
            'role="switch" aria-checked="false" aria-label="Toggle bird view camera">' +
            '<span class="toon-switch-knob"></span>' +
            '<span class="toon-switch-label"></span>' +
          '</button>' +
        '</div>' +
        '<div class="toon-section">LOOK SENSITIVITY</div>' +
        sliderRowHtml('toon-look-x', 'Horizontal Look') +
        sliderRowHtml('toon-look-y', 'Vertical Look') +
        '<button type="button" class="toon-reset" id="toon-look-reset">RESET LOOK</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var settingsBtn = overlay.querySelector('#toon-btn-settings');
  var refreshBtn = overlay.querySelector('#toon-btn-refresh');
  var homeBtn = overlay.querySelector('#toon-btn-home');
  var backBtn = overlay.querySelector('#toon-back');
  var debugSwitch = overlay.querySelector('#toon-switch-debug');
  var resetBtn = overlay.querySelector('#toon-look-reset');
  var cameraSwitch = overlay.querySelector('#toon-switch-camera');

  // ------------------------------------------------------------------
  // 4. Open / close / views
  // ------------------------------------------------------------------
  function isOpen() {
    return overlay.classList.contains('open');
  }

  function setView(view) {
    overlay.setAttribute('data-view', view);
  }

  function releasePointerLock() {
    // Desktop pointer lock hides the cursor; free it so the buttons are usable.
    // The game re-acquires it on the next mousedown outside this menu.
    if (document.pointerLockElement || document.webkitPointerLockElement) {
      try {
        if (document.exitPointerLock) document.exitPointerLock();
        else if (document.webkitExitPointerLock) document.webkitExitPointerLock();
      } catch (err) { /* ignore */ }
    }
  }

  function setOpen(open) {
    overlay.classList.toggle('open', open);
    btn.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    overlay.setAttribute('aria-hidden', String(!open));
    if (open) {
      setView('menu');
      releasePointerLock();
    } else {
      /* When the player closes the settings menu, ask the parent to
         go back to fullscreen (the parent page handles the actual API call). */
      if (window.self !== window.top) {
        try {
          window.parent.postMessage({ type: 'toon:request-fullscreen' }, '*');
        } catch (err) { /* ignore */ }
      }
    }
  }

  // Pointer events on the gear / overlay must never reach the game's
  // window-level listeners (pointer-lock re-acquire, etc.).
  function stopBubbling(e) { e.stopPropagation(); }
  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (type) {
    btn.addEventListener(type, stopBubbling);
    overlay.addEventListener(type, stopBubbling);
  });

  // After a mouse / touch click, drop focus so Space (jump) and WASD / arrow
  // keys keep going to the game instead of re-activating a focused control.
  // (click.detail is 0 for keyboard-generated clicks, so those keep focus.)
  function blurAfterPointerClick(e, el) {
    if (e.detail > 0) el.blur();
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    setOpen(!isOpen());
    blurAfterPointerClick(e, btn);
  });

  // Tap / click on the blurred background (not on a button or the card) closes.
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) setOpen(false);
  });

  settingsBtn.addEventListener('click', function (e) {
    e.preventDefault();
    setView('settings');
    blurAfterPointerClick(e, settingsBtn);
  });

  homeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    // When the game is running inside index.html's game-frame iframe (the
    // normal PLAY flow), ask the parent to close the overlay instead of
    // navigating away. This keeps the parent's fullscreen + landscape lock
    // alive, so there is no portrait flash and no fullscreen exit.
    // Falls back to a normal navigation if game.html was opened directly.
    if (window.self !== window.top) {
      try {
        window.parent.postMessage({ type: 'toon:return-to-menu' }, '*');
      } catch (err) { /* ignore */ }
      return;
    }
    window.location.href = 'index.html';
  });

  /* TEMPORARY REFRESH BUTTON ------------------------------------------
     Reloads ONLY game.html — this script runs INSIDE game.html (either
     as a normal page or inside index.html's game-frame iframe), so
     window.location.reload() reloads this document only. The parent
     page (index.html) is NEVER touched, so its fullscreen + landscape
     lock survive the refresh. */
  refreshBtn.addEventListener('click', function (e) {
    e.preventDefault();
    try {
      /* Explicitly reload THIS window (game.html / the game-frame
         iframe). Never touches the parent page. */
      window.location.reload();
    } catch (err) {
      /* Fallback for very old browsers: re-assign the current URL. */
      try { window.location.href = window.location.href; } catch (e2) { /* ignore */ }
    }
  });

  backBtn.addEventListener('click', function (e) {
    e.preventDefault();
    setView('menu');
    blurAfterPointerClick(e, backBtn);
  });

  // Esc: settings -> menu -> closed.
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Escape' || !isOpen()) return;
    if (overlay.getAttribute('data-view') === 'settings') setView('menu');
    else setOpen(false);
  });

  window.TOON_MENU = {
    open: function () { setOpen(true); },
    openSettings: function () {
      setOpen(true);
      setView('settings');
    },
    close: function () { setOpen(false); }
  };

  // ------------------------------------------------------------------
  // 5. Debug overlay switch (#hud)
  // ------------------------------------------------------------------
  var hud = document.getElementById('hud');

  function applyDebugState() {
    debugSwitch.classList.toggle('on', settings.debug);
    debugSwitch.setAttribute('aria-checked', String(settings.debug));
    if (hud) hud.style.display = settings.debug ? '' : 'none';
  }
  applyDebugState();

  debugSwitch.addEventListener('click', function (e) {
    e.preventDefault();
    settings.debug = !settings.debug;
    applyDebugState();
    save();
    blurAfterPointerClick(e, debugSwitch);
  });

  // ------------------------------------------------------------------
  // 5b. Camera view switch (bird view <-> third-person)
  //     The game owns the camera. This switch only ASKS for a mode through
  //     the 'toon:set-camera-mode' event; game.html calls
  //     TOON_MENU.setCameraMode(mode) back, so the switch always shows the
  //     REAL mode (it can also change with the C / V keys).
  // ------------------------------------------------------------------
  var cameraMode = 'third_person';

  function paintCameraSwitch() {
    var bird = cameraMode === 'bird_view';
    cameraSwitch.classList.toggle('on', bird);
    cameraSwitch.setAttribute('aria-checked', String(bird));
  }
  paintCameraSwitch();

  window.TOON_MENU.setCameraMode = function (mode) {
    cameraMode = (mode === 'bird_view') ? 'bird_view' : 'third_person';
    paintCameraSwitch();
  };

  cameraSwitch.addEventListener('click', function (e) {
    e.preventDefault();
    var next = (cameraMode === 'bird_view') ? 'third_person' : 'bird_view';
    window.dispatchEvent(new CustomEvent('toon:set-camera-mode', { detail: { mode: next } }));
    blurAfterPointerClick(e, cameraSwitch);
  });

  // ------------------------------------------------------------------
  // 6. Look sensitivity sliders (horizontal = x, vertical = y)
  // ------------------------------------------------------------------
  function bindSlider(sliderId, axis, key) {
    var slider = overlay.querySelector('#' + sliderId);
    var valueEl = overlay.querySelector('#' + sliderId + '-val');

    function paint(v) {
      var p = (v - SENS_MIN) / (SENS_MAX - SENS_MIN);
      slider.style.setProperty('--p', p.toFixed(4));
      valueEl.textContent = Math.round(v);
    }

    function setValue(v) {
      v = clampSens(v);
      slider.value = String(v);
      settings[key] = v;
      applySensitivity();
      paint(v);
    }

    setValue(settings[key]);

    slider.addEventListener('input', function () {
      setValue(slider.value);
      save();
    });

    // Release focus after a pointer drag so arrow keys keep steering the game.
    slider.addEventListener('pointerup', function () { slider.blur(); });

    return setValue;
  }

  var setLookX = bindSlider('toon-look-x', 'x', 'lookX');
  var setLookY = bindSlider('toon-look-y', 'y', 'lookY');

  resetBtn.addEventListener('click', function (e) {
    e.preventDefault();
    setLookX(SENS_DEFAULT);
    setLookY(SENS_DEFAULT);
    save();
    blurAfterPointerClick(e, resetBtn);
  });

  console.log('TOON MENU: gear + blurred menu mounted (PLAY WITH BOT / SETTINGS).');
})();