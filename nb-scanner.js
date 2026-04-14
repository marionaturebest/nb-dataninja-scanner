/*!
 * Nature's Best DataNinja Barcode Scanner
 * Injected via bookmarklet. Adds a floating Scan button that opens the rear
 * camera, decodes a barcode, and writes the value into the last-focused
 * input / textarea / contenteditable — no paste step required.
 *
 * Safe to load multiple times (re-load replaces state, not DOM).
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var BTN_ID = 'nb-scan-btn';
  var OVERLAY_ID = 'nb-scan-overlay';
  var TOAST_ID = 'nb-scan-toast';
  var LOG_ID = 'nb-scan-log';
  var STYLE_ID = 'nb-scan-style';
  var READER_ID = 'nb-scan-reader';

  // Config flags (can be toggled from the console: window.NB_SCAN.config.enterAfterScan = true)
  var config = {
    enterAfterScan: true,           // dispatch full Enter key sequence after injecting (DataNinja CR suffix)
    autoCloseOnScan: true,
    fps: 15,
    qrbox: { width: 260, height: 260 },
    formats: null                   // null = let html5-qrcode use all supported formats
  };

  // State
  var lastField = null;
  var html5QrCode = null;
  var scanLog = (window.NB_SCAN && window.NB_SCAN.log) || [];

  // --- Styles -------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#' + BTN_ID + '{position:fixed;top:20px;right:20px;width:64px;height:64px;border-radius:50%;',
      'background:#2d6a2e;color:#fff;border:none;box-shadow:0 4px 12px rgba(0,0,0,.3);',
      'font-size:28px;cursor:grab;z-index:999999;display:flex;align-items:center;justify-content:center;',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;touch-action:none;user-select:none}',
      '#' + BTN_ID + ':active{cursor:grabbing;transform:scale(.95)}',
      '#' + OVERLAY_ID + '{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000000;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff}',
      '#' + OVERLAY_ID + ' .nb-scan-title{font-size:18px;margin:0 0 12px;font-weight:600}',
      '#' + OVERLAY_ID + ' .nb-scan-target{font-size:13px;opacity:.8;margin:0 0 12px;max-width:90%;text-align:center;word-break:break-word}',
      '#' + READER_ID + '{width:min(90vw,400px);background:#000;border-radius:8px;overflow:hidden}',
      '#' + READER_ID + ' video{width:100%!important;height:auto!important;display:block}',
      '#' + OVERLAY_ID + ' .nb-scan-actions{margin-top:16px;display:flex;gap:12px}',
      '#' + OVERLAY_ID + ' button{padding:12px 20px;border-radius:8px;border:none;font-size:16px;',
      'font-weight:600;cursor:pointer;touch-action:manipulation}',
      '#' + OVERLAY_ID + ' .nb-scan-cancel{background:#c33;color:#fff}',
      '#' + OVERLAY_ID + ' .nb-scan-switch{background:#555;color:#fff}',
      '#' + TOAST_ID + '{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(120%);',
      'background:#2d6a2e;color:#fff;padding:12px 20px;border-radius:8px;z-index:1000001;',
      'box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,sans-serif;',
      'font-size:15px;transition:transform .25s ease;max-width:90vw;word-break:break-all}',
      '#' + TOAST_ID + '.nb-show{transform:translateX(-50%) translateY(0)}',
      '#' + TOAST_ID + '.nb-error{background:#c33}',
      '.nb-scan-flash{animation:nb-scan-flash .6s ease}',
      '@keyframes nb-scan-flash{0%{background:#b9f6ca}100%{background:transparent}}',
      '#' + LOG_ID + '{position:fixed;top:94px;right:20px;width:280px;max-height:40vh;',
      'background:rgba(0,0,0,.85);color:#b9f6ca;font-family:monospace;font-size:11px;',
      'padding:8px;border-radius:6px;overflow-y:auto;z-index:999998;display:none}',
      '#' + LOG_ID + '.nb-show{display:block}',
      '#' + LOG_ID + ' div{border-bottom:1px solid #333;padding:3px 0}'
    ].join('');
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // --- Toast --------------------------------------------------------------
  function toast(msg, isError) {
    var el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('nb-error', !!isError);
    // force reflow so the transition runs
    void el.offsetWidth;
    el.classList.add('nb-show');
    clearTimeout(el._nbT);
    el._nbT = setTimeout(function () { el.classList.remove('nb-show'); }, 2000);
  }

  // --- Log panel ----------------------------------------------------------
  function logEntry(value, target) {
    var rec = {
      ts: new Date().toISOString(),
      value: value,
      target: target ? describeField(target) : '(no field)'
    };
    scanLog.push(rec);
    if (scanLog.length > 50) scanLog.shift();
    var panel = document.getElementById(LOG_ID);
    if (panel) {
      var row = document.createElement('div');
      row.textContent = rec.ts.substring(11, 19) + ' ' + rec.value + ' -> ' + rec.target;
      panel.insertBefore(row, panel.firstChild);
    }
  }

  function describeField(el) {
    if (!el) return '(none)';
    var id = el.id ? '#' + el.id : '';
    var name = el.getAttribute('name') ? '[' + el.getAttribute('name') + ']' : '';
    return (el.tagName || '').toLowerCase() + id + name;
  }

  // --- Focus tracking -----------------------------------------------------
  function isTargetable(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'input') {
      var type = (el.type || 'text').toLowerCase();
      return ['text','search','tel','url','email','number','password',''].indexOf(type) !== -1;
    }
    if (tag === 'textarea') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onFocusIn(e) {
    if (isTargetable(e.target)) {
      lastField = e.target;
    }
  }

  // --- Field injection ----------------------------------------------------
  function injectValue(el, value) {
    if (!el) return false;
    var tag = (el.tagName || '').toLowerCase();
    try {
      if (tag === 'input' || tag === 'textarea') {
        var proto = tag === 'input' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
      } else if (el.isContentEditable) {
        el.textContent = value;
      } else {
        return false;
      }
      ['input', 'change', 'keyup'].forEach(function (evt) {
        el.dispatchEvent(new Event(evt, { bubbles: true }));
      });
      if (config.enterAfterScan) {
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
          var k = new KeyboardEvent(type, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: type === 'keypress' ? 13 : 0, bubbles: true, cancelable: true
          });
          el.dispatchEvent(k);
        });
      }
      flashField(el);
      return true;
    } catch (err) {
      console.error('[nb-scan] injectValue failed', err);
      return false;
    }
  }

  function flashField(el) {
    el.classList.add('nb-scan-flash');
    setTimeout(function () { el.classList.remove('nb-scan-flash'); }, 700);
  }

  // --- html5-qrcode loader ------------------------------------------------
  var CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';

  function ensureLibrary(cb) {
    if (window.Html5Qrcode) { cb(null); return; }
    var existing = document.querySelector('script[data-nb-scan-lib]');
    if (existing) {
      existing.addEventListener('load', function () { cb(null); });
      existing.addEventListener('error', function () { cb(new Error('cdn-load-failed')); });
      return;
    }
    var s = document.createElement('script');
    s.src = CDN_URL;
    s.async = true;
    s.setAttribute('data-nb-scan-lib', '1');
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('cdn-load-failed')); };
    document.head.appendChild(s);
  }

  // --- Scanner overlay ----------------------------------------------------
  function openScanner() {
    if (document.getElementById(OVERLAY_ID)) return;

    var targetDesc = lastField ? describeField(lastField) : 'No field selected — value will be copied to clipboard';

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML =
      '<div class="nb-scan-title">Scan barcode</div>' +
      '<div class="nb-scan-target">Target: ' + targetDesc + '</div>' +
      '<div id="' + READER_ID + '"></div>' +
      '<div class="nb-scan-actions">' +
        '<button class="nb-scan-cancel" type="button">Cancel</button>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.nb-scan-cancel').addEventListener('click', closeScanner);

    ensureLibrary(function (err) {
      if (err) {
        closeScanner();
        alert('Could not load scanner library. Check internet connection.');
        return;
      }
      startDecoder();
    });
  }

  function startDecoder() {
    try {
      html5QrCode = new window.Html5Qrcode(READER_ID, { verbose: false });
    } catch (err) {
      console.error('[nb-scan] init failed', err);
      toast('Scanner init failed', true);
      closeScanner();
      return;
    }

    var cfg = { fps: config.fps, qrbox: config.qrbox, aspectRatio: 1.0 };

    // Try rear camera first (iPad / phone); fall back to any available camera
    // (laptops / desktops with only a front webcam -> NotFoundError on 'environment').
    var tryStart = function (constraint) {
      return html5QrCode.start(
        constraint,
        cfg,
        onScanSuccess,
        function () { /* ignore per-frame decode failures */ }
      );
    };

    tryStart({ facingMode: 'environment' }).catch(function (err) {
      var msg = (err && err.message) || String(err);
      console.warn('[nb-scan] rear camera unavailable, falling back:', msg);
      if (/NotFound|OverConstrained/i.test(msg)) {
        // No rear camera — pick whatever the device has.
        return window.Html5Qrcode.getCameras().then(function (cams) {
          if (!cams || !cams.length) throw new Error('No cameras found');
          return tryStart(cams[0].id);
        });
      }
      throw err;
    }).catch(function (err) {
      console.error('[nb-scan] camera start failed', err);
      var msg = (err && err.message) || String(err);
      if (/permission|NotAllowed/i.test(msg)) {
        alert('Camera permission denied. In Chrome: tap the address bar lock icon > Site settings > Camera > Allow, then reload.');
      } else {
        alert('Could not start camera: ' + msg);
      }
      closeScanner();
    });
  }

  function onScanSuccess(decoded) {
    var injected = false;
    if (lastField && document.contains(lastField)) {
      injected = injectValue(lastField, decoded);
    }
    if (!injected) {
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(decoded);
      } catch (_) { /* noop */ }
      toast('Scanned (no field): ' + decoded, true);
    } else {
      toast('OK ' + decoded);
    }
    logEntry(decoded, lastField);
    if (config.autoCloseOnScan) closeScanner();
  }

  function closeScanner() {
    var done = function () {
      var overlay = document.getElementById(OVERLAY_ID);
      if (overlay) overlay.remove();
      html5QrCode = null;
    };
    if (html5QrCode) {
      try {
        html5QrCode.stop().then(function () {
          try { html5QrCode.clear(); } catch (_) {}
          done();
        }).catch(done);
      } catch (_) { done(); }
    } else {
      done();
    }
  }

  // --- Floating button ----------------------------------------------------
  var POS_KEY = 'nb-scan-pos';
  var DRAG_THRESHOLD = 6; // px — movement beyond this is a drag, not a tap

  function applySavedPosition(btn) {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return;
      var p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') {
        btn.style.left = p.left + 'px';
        btn.style.top = p.top + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      }
    } catch (_) { /* noop */ }
  }

  function savePosition(left, top) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: left, top: top })); } catch (_) {}
  }

  function clampToViewport(left, top, size) {
    var margin = 4;
    var maxLeft = window.innerWidth - size - margin;
    var maxTop = window.innerHeight - size - margin;
    return {
      left: Math.max(margin, Math.min(left, maxLeft)),
      top: Math.max(margin, Math.min(top, maxTop))
    };
  }

  function makeDraggable(btn, onTap, onDoubleTap) {
    var dragging = false;
    var moved = false;
    var startX = 0, startY = 0;
    var originLeft = 0, originTop = 0;
    var lastTap = 0;

    function pointer(e) {
      if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function onDown(e) {
      dragging = true;
      moved = false;
      var p = pointer(e);
      startX = p.x; startY = p.y;
      var rect = btn.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      // pin to absolute coords so the drag math matches
      btn.style.left = originLeft + 'px';
      btn.style.top = originTop + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
      btn.style.transition = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    }

    function onMove(e) {
      if (!dragging) return;
      var p = pointer(e);
      var dx = p.x - startX;
      var dy = p.y - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        moved = true;
      }
      if (moved) {
        if (e.cancelable) e.preventDefault();
        var size = btn.offsetWidth;
        var clamped = clampToViewport(originLeft + dx, originTop + dy, size);
        btn.style.left = clamped.left + 'px';
        btn.style.top = clamped.top + 'px';
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      btn.style.transition = '';
      if (!dragging) return;
      dragging = false;
      if (moved) {
        var rect = btn.getBoundingClientRect();
        savePosition(rect.left, rect.top);
      } else {
        // It was a tap (or double-tap)
        var now = Date.now();
        if (now - lastTap < 400) { onDoubleTap(); } else { onTap(); }
        lastTap = now;
      }
    }

    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('touchstart', onDown, { passive: true });
    // Suppress the native click so drags don't also fire the handler
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); });
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return;
    var btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Scan barcode');
    btn.title = 'Scan barcode (drag to move, double-tap for log)';
    btn.innerHTML = '&#9783;';
    document.body.appendChild(btn);

    applySavedPosition(btn);
    makeDraggable(btn, openScanner, toggleLog);

    // Re-clamp on orientation / resize so the button doesn't disappear offscreen
    window.addEventListener('resize', function () {
      var rect = btn.getBoundingClientRect();
      if (rect.left === 0 && rect.top === 0 && btn.style.left === '') return; // using default top/right
      var c = clampToViewport(rect.left, rect.top, btn.offsetWidth);
      btn.style.left = c.left + 'px';
      btn.style.top = c.top + 'px';
      savePosition(c.left, c.top);
    });

    var panel = document.createElement('div');
    panel.id = LOG_ID;
    document.body.appendChild(panel);
  }

  function toggleLog() {
    var panel = document.getElementById(LOG_ID);
    if (!panel) return;
    panel.classList.toggle('nb-show');
  }

  // --- Boot ---------------------------------------------------------------
  function boot() {
    injectStyles();
    injectButton();
    // Attach focus tracking once per page
    if (!window.NB_SCAN) {
      document.addEventListener('focusin', onFocusIn, true);
    }
    window.NB_SCAN = {
      version: VERSION,
      config: config,
      log: scanLog,
      open: openScanner,
      close: closeScanner,
      getLastField: function () { return lastField; }
    };
    console.log('[nb-scan] v' + VERSION + ' ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
