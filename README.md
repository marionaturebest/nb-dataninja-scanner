# DataNinja Barcode Scanner (Bookmarklet)

Zero-install, zero-cost replacement for the discontinued ScanKey keyboard-wedge
app. A JavaScript bookmarklet injects a floating Scan button into any web page
(primarily `naturebest.dataninja.com`) and writes decoded barcode values
directly into the last-focused input field — no paste step.

## Components

- `nb-scanner.js` — the injectable script (hosted on GitHub Pages)
- `index.html` — landing page with drag-to-bookmark link + iPad setup steps
- `test/test-page.html` — local form with event-logging for Phase-1 testing
- `test/test-barcodes.html` — sample QR / Code128 / Code39 / EAN-13 images

## Phase 1 — Local testing

1. Serve the folder over HTTP (camera APIs require `http://localhost` or HTTPS):
   ```bash
   cd dataninja-barcode-scanner
   python -m http.server 8000
   ```
2. On the iPad (same LAN), open `http://<host-ip>:8000/test/test-page.html`
   — or just use Chrome on a laptop with a webcam for initial smoke tests.
3. Tap a field, tap the green Scan button, point at a barcode from
   `test-barcodes.html` (open on a second screen).
4. Verify:
   - field receives the decoded value
   - `input` / `change` / `keyup` events fire (shown in the event log panel)
   - toast confirms the scan
   - contenteditable field also works

## Supported barcode formats

Everything `html5-qrcode` 2.3.x supports out of the box: QR, Code 128, Code 39,
Data Matrix, EAN-13/8, UPC-A/E, ITF, PDF 417, Aztec, Codabar.

## Runtime config

From the DevTools console after injection:

```js
NB_SCAN.config.enterAfterScan = false;  // disable Enter-after-scan (default: true)
NB_SCAN.config.autoCloseOnScan = false; // keep scanner open for continuous scanning
NB_SCAN.config.fps = 20;
NB_SCAN.log;                            // recent scans (in-memory, 50 max)
NB_SCAN.getLastField();                 // currently-tracked target element
```

Double-tap the floating Scan button to toggle an on-screen scan log panel.

## Security / privacy

- All decoding runs client-side via `html5-qrcode` (loaded from cdnjs).
- No values are transmitted anywhere.
- Script is open source; hosted from our own repo.

## Next phases

- **Phase 2** — deploy to GitHub Pages, test against DataNinja sandbox for CSP
  compatibility and framework event-listener behaviour.
- **Phase 3** — roll out to 20 iPads (bookmark sync via managed Google account,
  or manual per-device setup using `index.html` as the setup landing page).
