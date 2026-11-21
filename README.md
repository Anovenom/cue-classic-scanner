# The Cue Classic 2026 – Standalone Camera QR Scanner

Official mobile-first camera QR scanner for **THE CUE CLASSIC – SNOOKER CHAMPIONSHIP 2026**, presented by **STEPHER HAIR UNISEX SALON**.

This standalone scanner captures and decodes official championship ticket QR codes on mobile devices (optimized for iPhone) and communicates the scanned token back to the primary ticketing application via `window.opener.postMessage`.

---

## 1. Technical Architecture

- **Zero Build Tools / Frameworks**: Built entirely with standard HTML5, CSS3, and modern vanilla ES6 JavaScript. No npm build steps, webpack, or transpilation required.
- **Pinned Library**: Uses official `html5-qrcode@2.3.8` via CDN (`unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js`) with an automatic fallback to `cdnjs.cloudflare.com`.
- **Championship Visual Identity**:
  - Dark emerald-green baize backgrounds (`#030e09`, `#0a261c`).
  - Warm championship gold gradients (`#fae8a2` to `#d4af37` to `#9e7b16`).
  - High-readability ivory typography (`#fbf7ee`).
  - Snooker cue & ball iconography with gold viewfinder reticle corners and an animated laser sweep.
  - Full iOS Safari optimization: viewport-fit safe area insets, touch-friendly 48px+ targets, haptic feedback, and synthesized Web Audio chime.

---

## 2. QR Token Format Specification

The scanner validates the format before stopping the camera or dispatching any message:

$$\text{Format: } \texttt{TCCQR-} + 32 \text{ hexadecimal characters (38 total characters)}$$

- **Validation Regex**: `/^TCCQR-[0-9a-fA-F]{32}$/`
- **Valid Examples**:
  - `TCCQR-a1b2c3d4e5f60718293a4b5c6d7e8f90`
  - `TCCQR-8F9E0A1B2C3D4E5F6A7B8C9D0E1F2A3B`
- **Invalid Examples**:
  - Standard URLs (e.g., `https://...`)
  - Arbitrary barcodes or text strings
  - Truncated tokens (e.g., `TCCQR-12345`)

*Note: In accordance with tournament requirements, this scanner does NOT validate ticket status, payment state, duplicate check-ins, or event dates. Ticket validation logic is handled strictly by the Google Apps Script ticketing backend.*

---

## 3. Communication Protocol

When a valid token is scanned:
1. The camera stream is immediately stopped.
2. Audio and haptic confirmation are triggered.
3. If an opener window is detected (`window.opener && !window.opener.closed`), the scanner transmits:

```javascript
window.opener.postMessage({
  type: "TCC_QR_SCANNED",
  token: token
}, "*");
```

4. **Security**: No passwords, session tokens, customer data, or credentials are sent.
5. **Standalone Mode Fallback**: If the scanner was opened directly (without an opener), the scanner does not fail or crash. It presents a standalone screen displaying the verified token alongside a **Copy Token** button and a **Scan Next Ticket** option.

---

## 4. Camera Stream Lifecycle & Cleanup

- **Rear Camera Priority**: Requests `{ facingMode: "environment" }` by default for the rear lens, with automatic fallback to device enumeration (`Html5Qrcode.getCameras()`).
- **Complete Hardware Cleanup**: All `MediaStreamTrack` instances are explicitly stopped whenever:
  - The operator taps **Stop Camera**.
  - A valid ticket QR is decoded.
  - The browser window or tab is closed (`beforeunload` and `pagehide`).
  - The tab is hidden/backgrounded (`visibilitychange`).

---

## 5. File Structure

```text
cue-classic-scanner/
├── index.html         # Main standalone scanner application
├── test-opener.html   # Mock parent ticketing app to test postMessage integration
├── css/
│   └── scanner.css    # Championship theme, mobile styles, animations
├── js/
│   └── scanner.js     # Camera lifecycle, QR validation, opener dispatch
└── README.md          # Documentation and local testing instructions
```

---

## 6. How to Test Locally

Browsers require a **secure context** (`https://` or `localhost`) to access camera hardware.

### Option A: Using Python (Installed on your system)

1. Open PowerShell or Terminal in the repository root:
   ```bash
   cd c:\Users\HP\Projects\cue-classic-scanner
   python -m http.server 8000
   ```
2. Open your browser to:
   - **Main Scanner**: [http://localhost:8000/index.html](http://localhost:8000/index.html)
   - **Opener Test Harness**: [http://localhost:8000/test-opener.html](http://localhost:8000/test-opener.html)

### Option B: Using Node.js

```bash
npx serve .
# or
npx http-server -p 8000
```

### Testing the Opener Integration

1. Navigate to `http://localhost:8000/test-opener.html`.
2. Click **Open Scanner Window** (this launches `index.html` via `window.open`).
3. Notice the header indicator displays **"Connected to Ticketing App"**.
4. Tap **Start Camera** and grant camera permissions.
5. Aim the camera at a QR code containing `TCCQR-a1b2c3d4e5f60718293a4b5c6d7e8f90`.
6. The scanner will chime, stop the camera, and display the result modal.
7. Switch back to the test opener tab to observe the received token in the live event log.

### Testing on an iPhone over Local Wi-Fi

Modern iOS Safari requires HTTPS when accessing the camera from an external IP address (e.g. `192.168.x.x`). To test directly on an iPhone:
- Use a tunneling tool such as `cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`.
- Or test with Safari Web Inspector via USB tethering to your computer.

---

## 7. Connecting to Google Apps Script (Next Step)

In your existing Google Apps Script web application (HTML service), simply add the following to launch the scanner and receive tickets:

```javascript
// 1. Open the scanner
function launchTicketScanner() {
  const scannerUrl = "https://<your-hosted-domain>/index.html";
  window.open(scannerUrl, "CueClassicScanner", "width=460,height=760");
}

// 2. Listen for the token
window.addEventListener("message", function(event) {
  if (event.data && event.data.type === "TCC_QR_SCANNED") {
    const ticketToken = event.data.token;
    console.log("Scanned Ticket Token:", ticketToken);

    // Call your existing Apps Script backend validation function
    google.script.run
      .withSuccessHandler(handleValidationSuccess)
      .withFailureHandler(handleValidationFailure)
      .validateTicketCheckIn(ticketToken);
  }
});
```
