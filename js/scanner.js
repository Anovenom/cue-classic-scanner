/**
 * THE CUE CLASSIC – SNOOKER CHAMPIONSHIP 2026
 * Presented by STEPHER HAIR UNISEX SALON
 * Standalone Camera QR Scanner Module
 *
 * Requirements:
 * - Pure vanilla ES6 JavaScript (no frameworks/build tools)
 * - Pinned library html5-qrcode@2.3.8
 * - Target format: TCCQR- followed by exactly 32 hexadecimal characters
 * - Opener dispatch: { type: "TCC_QR_SCANNED", token: token } via window.opener.postMessage
 * - Graceful standalone fallback when window.opener is missing or closed
 * - Strict media stream cleanup on stop, beforeunload, and pagehide
 */

(function () {
  "use strict";

  // =========================================================================
  // Constants & Validation Regex
  // =========================================================================

  /**
   * Accepts ONLY strings matching TCCQR- followed by exactly 32 hexadecimal characters.
   * Total length: 38 characters.
   */
  const TCC_TOKEN_REGEX = /^TCCQR-[0-9a-fA-F]{32}$/;

  // DOM Selectors
  const elements = {
    reader: document.getElementById("reader"),
    placeholder: document.getElementById("viewfinder-placeholder"),
    viewfinderWrapper: document.getElementById("viewfinder-wrapper"),
    statusDot: document.getElementById("status-pulse-dot"),
    statusText: document.getElementById("status-text"),
    openerPill: document.getElementById("opener-status-pill"),
    openerPillText: document.getElementById("opener-pill-text"),
    btnStart: document.getElementById("btn-start-camera"),
    btnStop: document.getElementById("btn-stop-camera"),
    btnTorch: document.getElementById("btn-toggle-torch"),
    btnSwitchCamera: document.getElementById("btn-switch-camera"),
    cameraSelectRow: document.getElementById("camera-select-row"),
    cameraSelect: document.getElementById("camera-select"),
    modalBackdrop: document.getElementById("result-modal"),
    resultTokenText: document.getElementById("result-token-text"),
    dispatchBanner: document.getElementById("dispatch-banner"),
    dispatchText: document.getElementById("dispatch-text"),
    btnCopyToken: document.getElementById("btn-copy-token"),
    btnScanAgain: document.getElementById("btn-scan-again"),
    btnCloseModal: document.getElementById("btn-close-modal"),
    toastContainer: document.getElementById("toast-container"),
  };

  // State Management
  let html5QrCode = null;
  let isScanning = false;
  let isTorchOn = false;
  let currentCameraId = null;
  let availableCameras = [];
  let lastInvalidScanTimestamp = 0;
  let audioContext = null;

  // =========================================================================
  // Initialization
  // =========================================================================

  document.addEventListener("DOMContentLoaded", () => {
    inspectOpenerStatus();
    initHtml5QrcodeInstance();
    bindEventListeners();
    checkSecureContext();
  });

  /**
   * Checks whether the scanner was opened by the Cue Classic ticketing app
   * via window.opener, updating the status pill accordingly.
   */
  function inspectOpenerStatus() {
    const hasOpener = isOpenerAvailable();

    if (elements.openerPill && elements.openerPillText) {
      if (hasOpener) {
        elements.openerPill.classList.remove("standalone");
        elements.openerPill.classList.add("connected");
        elements.openerPillText.textContent = "Connected to Ticketing App";
      } else {
        elements.openerPill.classList.remove("connected");
        elements.openerPill.classList.add("standalone");
        elements.openerPillText.textContent = "Standalone Scanner Mode";
      }
    }
  }

  /**
   * Safe check for window.opener existence and open state.
   */
  function isOpenerAvailable() {
    try {
      return Boolean(window.opener && !window.opener.closed);
    } catch (e) {
      return false;
    }
  }

  /**
   * Validates if the page is running in a secure context (HTTPS or localhost),
   * required by browsers for camera access via getUserMedia.
   */
  function checkSecureContext() {
    const isLocal =
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1" ||
      location.hostname === "[::1]";

    if (window.isSecureContext === false && !isLocal) {
      showToast(
        "Camera access requires a secure connection (HTTPS). Some browsers may block video capture.",
        "warning",
        7000
      );
    }
  }

  /**
   * Initializes the Html5Qrcode instance once the CDN library is ready.
   */
  function initHtml5QrcodeInstance() {
    if (typeof Html5Qrcode === "undefined") {
      showToast(
        "QR Scanner library (html5-qrcode) could not be loaded. Please check your network connection.",
        "error",
        10000
      );
      updateStatus("error", "Library Error");
      return;
    }

    try {
      html5QrCode = new Html5Qrcode("reader", {
        verbose: false,
      });
      loadAvailableCameras();
    } catch (err) {
      console.error("Html5Qrcode initialization error:", err);
      updateStatus("error", "Init Failed");
    }
  }

  /**
   * Discovers connected cameras for optional switching and torch support.
   */
  async function loadAvailableCameras() {
    if (typeof Html5Qrcode === "undefined") return;

    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        availableCameras = devices;
        populateCameraSelect(devices);

        // Show switch camera button if more than 1 camera exists
        if (devices.length > 1 && elements.btnSwitchCamera) {
          elements.btnSwitchCamera.style.display = "flex";
        }
      }
    } catch (err) {
      // Camera permission might not be granted yet, which is expected before first prompt
      console.log("Camera list discovery deferred until permission grant:", err);
    }
  }

  function populateCameraSelect(devices) {
    if (!elements.cameraSelect) return;
    elements.cameraSelect.innerHTML = "";

    devices.forEach((cam, index) => {
      const option = document.createElement("option");
      option.value = cam.id;
      option.textContent = cam.label || `Camera ${index + 1}`;
      elements.cameraSelect.appendChild(option);
    });

    if (devices.length > 1 && elements.cameraSelectRow) {
      elements.cameraSelectRow.style.display = "flex";
    }
  }

  // =========================================================================
  // Camera Controls & Lifecycle
  // =========================================================================

  /**
   * Requests camera access and begins continuous QR scanning.
   * Prefers the rear / environment camera on mobile phones.
   */
  async function startScanning() {
    if (isScanning) return;

    if (!html5QrCode) {
      initHtml5QrcodeInstance();
      if (!html5QrCode) return;
    }

    updateStatus("processing", "Requesting Camera...");
    setButtonState(true);

    // Dynamic QR box sizing relative to container
    const qrboxFunction = function (viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const targetSize = Math.floor(minEdge * 0.72);
      const clampedSize = Math.max(180, Math.min(320, targetSize));
      return { width: clampedSize, height: clampedSize };
    };

    const config = {
      fps: 12,
      qrbox: qrboxFunction,
      aspectRatio: 1.0,
      showTorchButtonIfSupported: false, // We provide a custom styled button
    };

    // Determine camera constraint: selected device ID or rear camera preference
    let cameraConstraint = { facingMode: "environment" };

    if (currentCameraId) {
      cameraConstraint = { deviceId: { exact: currentCameraId } };
    }

    try {
      await html5QrCode.start(
        cameraConstraint,
        config,
        onScanSuccess,
        onScanProgressError
      );

      isScanning = true;
      updateStatus("scanning", "Scanning for Ticket QR...");
      setScanningUI(true);

      // Inspect track capabilities for torch support
      inspectTorchCapability();

      // Refresh camera list once permission is granted
      if (availableCameras.length === 0) {
        loadAvailableCameras();
      }
    } catch (err) {
      console.warn("Primary camera start error, attempting fallback:", err);
      // Fallback: If { facingMode: "environment" } failed, try camera list or default
      await attemptCameraFallback(config, err);
    }
  }

  /**
   * Fallback strategy for devices where direct facingMode constraint is rejected.
   */
  async function attemptCameraFallback(config, initialError) {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 0) {
        availableCameras = devices;
        populateCameraSelect(devices);

        // Pick back camera if labeled, or the last device (common rear camera index on iOS/Android)
        let chosen = devices.find((d) =>
          /back|rear|environment|macro/i.test(d.label || "")
        );
        if (!chosen) {
          chosen = devices[devices.length - 1];
        }

        currentCameraId = chosen.id;
        if (elements.cameraSelect) {
          elements.cameraSelect.value = chosen.id;
        }

        await html5QrCode.start(
          { deviceId: { exact: chosen.id } },
          config,
          onScanSuccess,
          onScanProgressError
        );

        isScanning = true;
        updateStatus("scanning", "Scanning for Ticket QR...");
        setScanningUI(true);
        inspectTorchCapability();
        return;
      }
    } catch (fallbackErr) {
      console.error("Camera fallback also failed:", fallbackErr);
    }

    // If all attempts fail, report user-friendly error
    handleCameraError(initialError);
    setButtonState(false);
    updateStatus("error", "Camera Inactive");
  }

  /**
   * Stops scanning and thoroughly releases all camera hardware streams.
   */
  async function stopScanning() {
    if (!html5QrCode) return;

    try {
      if (isScanning || html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (err) {
      console.warn("Html5Qrcode stop notice:", err);
    } finally {
      // Clean up hardware streams and tracks directly
      releaseMediaStreamTracks();
      isScanning = false;
      isTorchOn = false;
      if (elements.btnTorch) {
        elements.btnTorch.classList.remove("active");
        elements.btnTorch.style.display = "none";
      }
      setScanningUI(false);
      setButtonState(false);
      updateStatus("ready", "Camera Stopped");
    }
  }

  /**
   * Direct cleanup of all MediaStream tracks from video elements.
   * Guarantees camera light turns off on iOS Safari and modern browsers.
   */
  function releaseMediaStreamTracks() {
    try {
      const videoElements = document.querySelectorAll("#reader video");
      videoElements.forEach((video) => {
        if (video.srcObject) {
          const stream = video.srcObject;
          if (stream && typeof stream.getTracks === "function") {
            stream.getTracks().forEach((track) => {
              try {
                track.stop();
              } catch (e) {
                console.warn("Track stop error:", e);
              }
            });
          }
          video.srcObject = null;
        }
      });
    } catch (e) {
      console.warn("Stream release warning:", e);
    }
  }

  /**
   * Switches to the next available camera.
   */
  async function switchCamera() {
    if (availableCameras.length < 2) return;

    let currentIndex = availableCameras.findIndex(
      (c) => c.id === currentCameraId
    );
    let nextIndex = (currentIndex + 1) % availableCameras.length;
    currentCameraId = availableCameras[nextIndex].id;

    if (elements.cameraSelect) {
      elements.cameraSelect.value = currentCameraId;
    }

    if (isScanning) {
      await stopScanning();
      await startScanning();
    }
  }

  /**
   * Toggles flashlight / torch if supported by the camera track.
   */
  async function toggleTorch() {
    if (!isScanning || !html5QrCode) return;

    try {
      const video = document.querySelector("#reader video");
      if (!video || !video.srcObject) return;

      const track = video.srcObject.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      if (!capabilities.torch) {
        showToast("Torch / Flashlight is not supported on this camera.", "info", 3000);
        return;
      }

      isTorchOn = !isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: isTorchOn }],
      });

      if (elements.btnTorch) {
        elements.btnTorch.classList.toggle("active", isTorchOn);
      }
    } catch (err) {
      console.warn("Torch toggle error:", err);
      showToast("Could not toggle camera torch.", "warning", 3000);
    }
  }

  function inspectTorchCapability() {
    try {
      const video = document.querySelector("#reader video");
      if (video && video.srcObject) {
        const track = video.srcObject.getVideoTracks()[0];
        if (track && track.getCapabilities) {
          const caps = track.getCapabilities();
          if (caps.torch && elements.btnTorch) {
            elements.btnTorch.style.display = "flex";
            return;
          }
        }
      }
    } catch (e) {
      // Capability check unsupported on this platform
    }

    if (elements.btnTorch) {
      elements.btnTorch.style.display = "none";
    }
  }

  // =========================================================================
  // QR Code Processing & Validation
  // =========================================================================

  /**
   * Validates whether the scanned string adheres to the Cue Classic ticket format:
   * "TCCQR-" followed by exactly 32 hexadecimal characters.
   */
  function isValidCueClassicToken(rawText) {
    if (typeof rawText !== "string") return false;
    const clean = rawText.trim();
    return TCC_TOKEN_REGEX.test(clean);
  }

  /**
   * Successful QR detection handler.
   */
  async function onScanSuccess(decodedText) {
    const token = (decodedText || "").trim();

    // Check token specification
    if (!isValidCueClassicToken(token)) {
      handleInvalidQrCode(token);
      return;
    }

    // Valid ticket QR detected!
    playHapticAndChime();
    updateStatus("processing", "Ticket QR Detected!");

    // Stop scanning and camera streams immediately
    await stopScanning();

    // Handle communication with parent window or standalone fallback
    dispatchScannedToken(token);
  }

  /**
   * Frame-by-frame scanner progress (called when no QR is in view).
   * Intentionally quiet to prevent console noise.
   */
  function onScanProgressError() {
    // No-op: standard scan evaluation frame
  }

  /**
   * Rejects non-championship QR codes with throttled user guidance.
   */
  function handleInvalidQrCode(scannedContent) {
    const now = Date.now();
    // Throttle invalid code toasts so the UI doesn't spam on every video frame
    if (now - lastInvalidScanTimestamp > 2500) {
      lastInvalidScanTimestamp = now;
      const preview =
        scannedContent.length > 20
          ? scannedContent.substring(0, 18) + "..."
          : scannedContent;

      showToast(
        `Invalid QR: "${preview}". Expected Cue Classic ticket format (TCCQR- + 32 hex chars).`,
        "warning",
        3500
      );
      updateStatus("warning", "Non-Championship QR");

      setTimeout(() => {
        if (isScanning) {
          updateStatus("scanning", "Scanning for Ticket QR...");
        }
      }, 2500);
    }
  }

  // =========================================================================
  // Opener Communication & Result Display
  // =========================================================================

  /**
   * Dispatches the valid token to window.opener if available,
   * or transitions smoothly to standalone mode.
   *
   * Requirement 6:
   * Message: { type: "TCC_QR_SCANNED", token: token }
   * Target: window.opener.postMessage(message, "*")
   * No credentials, passwords, or customer data transmitted.
   */
  function dispatchScannedToken(token) {
    const hasOpener = isOpenerAvailable();

    // Set token in modal
    if (elements.resultTokenText) {
      elements.resultTokenText.textContent = token;
    }

    if (hasOpener) {
      try {
        const payload = {
          type: "TCC_QR_SCANNED",
          token: token,
        };

        window.opener.postMessage(payload, "*");

        setDispatchUI(
          "sent",
          "✓ Successfully sent to The Cue Classic ticketing app."
        );
      } catch (err) {
        console.error("postMessage transmission failed:", err);
        setDispatchUI(
          "standalone",
          "Could not send to opener window. You can copy the token below."
        );
      }
    } else {
      // Standalone mode: opened without Cue Classic parent window
      setDispatchUI(
        "standalone",
        "Standalone Mode: Scanner was opened directly. The token has been captured and can be copied below."
      );
    }

    // Present the result modal
    showResultModal(true);
  }

  function setDispatchUI(state, message) {
    if (!elements.dispatchBanner || !elements.dispatchText) return;

    elements.dispatchBanner.className = "dispatch-banner " + state;
    elements.dispatchText.textContent = message;
  }

  function showResultModal(visible) {
    if (!elements.modalBackdrop) return;
    if (visible) {
      elements.modalBackdrop.classList.add("active");
    } else {
      elements.modalBackdrop.classList.remove("active");
    }
  }

  // =========================================================================
  // Audio & Haptic Feedback
  // =========================================================================

  /**
   * Synthesizes an elegant two-tone chime via native Web Audio API
   * and triggers device vibration where supported.
   */
  function playHapticAndChime() {
    // 1. Haptic feedback
    if (navigator.vibrate) {
      try {
        navigator.vibrate([70, 40, 90]);
      } catch (e) {}
    }

    // 2. Synthesized audio chime (D5 -> A5 ascending championship tone)
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContext) {
        audioContext = new AudioCtx();
      }

      if (audioContext.state === "suspended") {
        audioContext.resume();
      }

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = "sine";
      osc.connect(gain);
      gain.connect(audioContext.destination);

      const now = audioContext.currentTime;
      // D5 (587.33Hz) to A5 (880Hz)
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.09);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.22, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.start(now);
      osc.stop(now + 0.38);
    } catch (e) {
      // Audio autoplay policy or lack of audio hardware; non-critical
    }
  }

  // =========================================================================
  // UI Helpers & Error Notifications
  // =========================================================================

  function updateStatus(type, label) {
    if (!elements.statusDot || !elements.statusText) return;

    elements.statusDot.className = "status-pulse-dot";
    switch (type) {
      case "ready":
        elements.statusDot.classList.add("pulse-ready");
        break;
      case "scanning":
        elements.statusDot.classList.add("pulse-scanning");
        break;
      case "error":
        elements.statusDot.classList.add("pulse-error");
        break;
      case "warning":
        elements.statusDot.classList.add("pulse-error");
        break;
      default:
        elements.statusDot.classList.add("pulse-ready");
    }

    elements.statusText.textContent = label;
  }

  function setScanningUI(active) {
    if (elements.placeholder) {
      elements.placeholder.classList.toggle("hidden", active);
    }
    if (elements.viewfinderWrapper) {
      elements.viewfinderWrapper.classList.toggle("is-scanning", active);
    }
  }

  function setButtonState(scanning) {
    if (elements.btnStart) {
      elements.btnStart.style.display = scanning ? "none" : "flex";
    }
    if (elements.btnStop) {
      elements.btnStop.style.display = scanning ? "flex" : "none";
    }
  }

  function handleCameraError(err) {
    console.error("Camera access error:", err);
    let msg = "Could not access camera. Please check browser permissions.";

    const errName = err && (err.name || err.toString());

    if (/NotAllowedError|PermissionDeniedError/i.test(errName)) {
      msg =
        "Camera permission was denied. Please allow camera access in your browser or iOS Settings > Safari > Camera.";
    } else if (/NotFoundError|DevicesNotFoundError/i.test(errName)) {
      msg = "No suitable camera found on this device.";
    } else if (/NotReadableError|TrackStartError/i.test(errName)) {
      msg =
        "Camera hardware is currently in use by another tab or app. Please close other camera apps and retry.";
    } else if (/OverconstrainedError|ConstraintNotSatisfied/i.test(errName)) {
      msg = "Rear camera constraints not supported on this device. Retrying with default camera...";
    }

    showToast(msg, "error", 6000);
  }

  function showToast(message, type = "info", duration = 4000) {
    if (!elements.toastContainer) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const iconSvg =
      type === "error"
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : type === "warning"
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

    toast.innerHTML = `
      <div class="toast-icon">${iconSvg}</div>
      <div class="toast-content">${escapeHTML(message)}</div>
      <button class="toast-close-btn" aria-label="Close">&times;</button>
    `;

    const closeBtn = toast.querySelector(".toast-close-btn");
    closeBtn.addEventListener("click", () => {
      toast.remove();
    });

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-10px)";
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function copyTokenToClipboard() {
    const text = elements.resultTokenText
      ? elements.resultTokenText.textContent
      : "";
    if (!text) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      if (elements.btnCopyToken) {
        const originalText = elements.btnCopyToken.innerHTML;
        elements.btnCopyToken.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Copied to Clipboard!
        `;
        setTimeout(() => {
          if (elements.btnCopyToken) elements.btnCopyToken.innerHTML = originalText;
        }, 2200);
      }
    } catch (err) {
      showToast("Could not copy token automatically.", "warning", 2500);
    }
  }

  // =========================================================================
  // Event Bindings & Stream Cleanup Hooks
  // =========================================================================

  function bindEventListeners() {
    // Start Camera button
    if (elements.btnStart) {
      elements.btnStart.addEventListener("click", () => {
        // Unlock Web Audio context on user gesture
        if (!audioContext) {
          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) audioContext = new AudioCtx();
          } catch (e) {}
        }
        startScanning();
      });
    }

    // Stop Camera button
    if (elements.btnStop) {
      elements.btnStop.addEventListener("click", () => {
        stopScanning();
      });
    }

    // Torch / Flashlight button
    if (elements.btnTorch) {
      elements.btnTorch.addEventListener("click", () => {
        toggleTorch();
      });
    }

    // Switch Camera button
    if (elements.btnSwitchCamera) {
      elements.btnSwitchCamera.addEventListener("click", () => {
        switchCamera();
      });
    }

    // Camera select dropdown change
    if (elements.cameraSelect) {
      elements.cameraSelect.addEventListener("change", (e) => {
        currentCameraId = e.target.value;
        if (isScanning) {
          stopScanning().then(() => startScanning());
        }
      });
    }

    // Copy token button
    if (elements.btnCopyToken) {
      elements.btnCopyToken.addEventListener("click", () => {
        copyTokenToClipboard();
      });
    }

    // Scan again button (modal)
    if (elements.btnScanAgain) {
      elements.btnScanAgain.addEventListener("click", () => {
        showResultModal(false);
        startScanning();
      });
    }

    // Close window / dismiss modal button
    if (elements.btnCloseModal) {
      elements.btnCloseModal.addEventListener("click", () => {
        showResultModal(false);
        // If opened as a popup by an opener, attempt to close the window
        if (isOpenerAvailable()) {
          try {
            window.close();
          } catch (e) {}
        }
      });
    }

    // Requirement 9: Clean up camera streams when page closes or unloads
    window.addEventListener("beforeunload", () => {
      releaseMediaStreamTracks();
      if (html5QrCode && (isScanning || html5QrCode.isScanning)) {
        try {
          html5QrCode.stop();
        } catch (e) {}
      }
    });

    window.addEventListener("pagehide", () => {
      releaseMediaStreamTracks();
      if (html5QrCode && (isScanning || html5QrCode.isScanning)) {
        try {
          html5QrCode.stop();
        } catch (e) {}
      }
    });

    // Pause when app is backgrounded or tab hidden
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && isScanning) {
        stopScanning();
      }
    });
  }
})();
