// ── Content Script: Auto-detect call activity on web softphone pages ─────────
// Enhanced for LSA InterpreCloud (agent.lsaweb.com) + generic softphones
// v2.6 — Compatible with multi-block schedule system

(function() {
  'use strict';

  if (window.__wfmCallDetectorInjected) return;
  window.__wfmCallDetectorInjected = true;

  let callActive = false;
  let checkInterval = null;
  let hostname = location.hostname.toLowerCase();
  let isLSA = hostname.includes('lsaweb.com') || hostname.includes('agent.lsaweb');
  let extensionValid = true;

  // ── Safe messaging wrapper ───────────────────────────────────────────────────
  function sendMessageSafe(msg) {
    if (!extensionValid) return;
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          if (chrome.runtime.lastError.message && 
              chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            extensionValid = false;
            console.log('[WFM] Extension context invalidated. Stopping detection.');
            if (checkInterval) {
              clearInterval(checkInterval);
              checkInterval = null;
            }
          }
        }
      });
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) {
        extensionValid = false;
        console.log('[WFM] Extension context invalidated. Stopping detection.');
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    }
  }

  // ── LSA InterpreCloud Specific Detectors ───────────────────────────────────
  function detectLSACallState() {
    const bodyText = document.body ? document.body.innerText : '';
    const bodyHTML = document.body ? document.body.innerHTML : '';

    const wrapupIndicators = [
      bodyText.includes('Wrap-Up'),
      bodyText.includes('Call result'),
      bodyText.includes('Save and close'),
      bodyText.includes('Make unavailable after call'),
      !!document.querySelector('.active, .selected, .highlighted'),
      (bodyText.includes('Account code') || bodyText.includes('Call ID')) && 
      !bodyText.includes('In Progress') && !bodyText.includes('Connected'),
    ];

    const activeIndicators = [
      bodyText.includes('In Progress'),
      bodyText.includes('Connected'),
      bodyText.includes('On Call'),
      bodyText.includes('Call in progress'),
      bodyText.includes('Interpretation in progress'),
      !!document.querySelector('[class*="timer"], [class*="duration"], [class*="elapsed"]'),
      !!document.querySelector('button[aria-label*="mute"], button[title*="mute"], [class*="mute"]'),
      !!document.querySelector('button[aria-label*="end"], button[title*="end"], [class*="end-call"], [class*="hangup"], [class*="disconnect"]'),
    ];

    const ringingIndicators = [
      bodyText.includes('Incoming Call'),
      bodyText.includes('Softphone Ringing'),
      bodyText.includes('Please wait while the call is being delivered'),
      !!document.querySelector('button[aria-label*="Answer"], button[title*="Answer"], [class*="answer"]'),
    ];

    const breakIndicators = [
      bodyText.includes('Short Break'),
      bodyText.includes('Long Break'),
      bodyText.includes('Unavailable'),
      !!Array.from(document.querySelectorAll('button, span, div, a, label')).find(el => 
        /Short Break|Long Break/i.test(el.textContent)
      ),
      !!Array.from(document.querySelectorAll('span, div, label, button, a')).find(el =>
        /^\s*Unavailable\s*$/i.test(el.textContent)
      ),
      !!Array.from(document.querySelectorAll('*')).find(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        return /Unavailable/i.test(el.textContent) && 
               (bg.includes('rgb(220') || bg.includes('rgb(200') || bg.includes('rgb(255, 0') || bg.includes('red') || bg.includes('#dc') || bg.includes('#c0') || bg.includes('#ff'));
      }),
    ];

    const readyIndicators = [
      bodyText.includes('Softphone Ready'),
      bodyText.includes('Available'),
      !!Array.from(document.querySelectorAll('span, div, button, a, label')).find(el =>
        /^\s*Ready\s*$/i.test(el.textContent) || /^\s*Softphone Ready\s*$/i.test(el.textContent)
      ),
    ];

    const wrapupScore = wrapupIndicators.filter(Boolean).length;
    const activeScore = activeIndicators.filter(Boolean).length;
    const ringingScore = ringingIndicators.filter(Boolean).length;
    const breakScore = breakIndicators.filter(Boolean).length;
    const readyScore = readyIndicators.filter(Boolean).length;

    return {
      onCall: activeScore >= 2 && wrapupScore < 2,
      wrapUp: wrapupScore >= 2,
      ringing: ringingScore >= 2,
      onBreak: breakScore >= 2,
      isReady: readyScore >= 1 && breakScore < 2,
      activeScore, wrapupScore, ringingScore, breakScore, readyScore
    };
  }

  // ── Generic Softphone Detectors ────────────────────────────────────────────
  const CALL_INDICATORS = [
    { selector: 'body', text: /(on a call|call in progress|connected|live call|ongoing call|interpretation in progress)/i },
    { selector: '[class*="call-timer"], [class*="callTimer"], [class*="duration"], [class*="elapsed"], [class*="timer"]', exists: true },
    { selector: '[class*="in-call"], [class*="incall"], [class*="on-call"], [class*="oncall"], [class*="connected"]', exists: true },
    { selector: 'button[aria-label*="mute"], button[title*="mute"], [class*="mute-button"], [class*="mute"]', exists: true },
    { selector: 'button[aria-label*="end call"], button[title*="end call"], [class*="end-call"], [class*="hangup"], [class*="disconnect"]', exists: true },
    { webrtc: true },
  ];

  function detectGenericCallState() {
    let score = 0;
    let indicators = 0;

    for (const ind of CALL_INDICATORS) {
      if (ind.selector && ind.text) {
        const el = document.querySelector(ind.selector);
        if (el && ind.text.test(el.textContent)) {
          score += 2;
          indicators++;
        }
      } else if (ind.selector && ind.exists) {
        const els = document.querySelectorAll(ind.selector);
        if (els.length > 0) {
          score += 1;
          indicators++;
        }
      } else if (ind.webrtc) {
        if (window.RTCPeerConnection && window.__wfmPeerConnections) {
          const activeConns = window.__wfmPeerConnections.filter(pc => 
            pc.connectionState === 'connected' || pc.signalingState === 'stable'
          );
          if (activeConns.length > 0) {
            score += 3;
            indicators++;
          }
        }
      }
    }
    return { onCall: indicators >= 2 && score >= 3, ringing: false };
  }

  function detectCallState() {
    if (isLSA) {
      return detectLSACallState();
    }
    return detectGenericCallState();
  }

  // ── WebRTC Hook ───────────────────────────────────────────────────────────
  if (window.RTCPeerConnection && !window.__wfmPeerConnectionHooked) {
    window.__wfmPeerConnections = [];
    const OriginalRTCPeerConnection = window.RTCPeerConnection;

    window.RTCPeerConnection = function(...args) {
      const pc = new OriginalRTCPeerConnection(...args);
      window.__wfmPeerConnections.push(pc);
      pc.addEventListener('connectionstatechange', () => {
        cleanupPeerConnections();
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    window.__wfmPeerConnectionHooked = true;
  }

  function cleanupPeerConnections() {
    if (window.__wfmPeerConnections) {
      window.__wfmPeerConnections = window.__wfmPeerConnections.filter(
        pc => pc.connectionState !== 'closed' && pc.connectionState !== 'failed'
      );
    }
  }

  // ── State Machine ─────────────────────────────────────────────────────────
  function onCallDetected() {
    if (!callActive) {
      callActive = true;
      sendMessageSafe({ type: "CONTENT_CALL_DETECTED" });
    }
  }

  function onCallEnded() {
    if (callActive) {
      callActive = false;
      sendMessageSafe({ type: "CONTENT_CALL_ENDED" });
    }
  }

  let noCallCount = 0;
  let lastBreakState = false;
  let lastReadyState = false;
  let lastWrapupState = false;
  let breakDebounce = 0;
  let readyDebounce = 0;
  let wrapupDebounce = 0;

  function tick() {
    if (!extensionValid) {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      return;
    }

    const state = detectCallState();

    if (isLSA) {
      if (state.onCall) {
        onCallDetected();
        noCallCount = 0;
        wrapupDebounce = 0;
        lastBreakState = false;
        lastReadyState = false;
        lastWrapupState = false;
      } else if (state.wrapUp) {
        noCallCount++;
        if (noCallCount >= 2) {
          onCallEnded();
          noCallCount = 0;
        }
        wrapupDebounce++;
        if (wrapupDebounce >= 2 && !lastWrapupState) {
          lastWrapupState = true;
          lastBreakState = false;
          lastReadyState = false;
          sendMessageSafe({ type: "CONTENT_WRAPUP_DETECTED" });
        }
      } else {
        noCallCount++;
        if (noCallCount >= 3) {
          onCallEnded();
          noCallCount = 0;
        }
        wrapupDebounce = 0;
        lastWrapupState = false;

        if (state.onBreak) {
          breakDebounce++;
          readyDebounce = 0;
          if (breakDebounce >= 2 && !lastBreakState) {
            lastBreakState = true;
            lastReadyState = false;
            sendMessageSafe({ type: "CONTENT_BREAK_DETECTED" });
          }
        } else if (state.isReady) {
          readyDebounce++;
          breakDebounce = 0;
          if (readyDebounce >= 2 && !lastReadyState) {
            lastReadyState = true;
            lastBreakState = false;
            sendMessageSafe({ type: "CONTENT_READY_DETECTED" });
          }
        } else {
          breakDebounce = Math.max(0, breakDebounce - 1);
          readyDebounce = Math.max(0, readyDebounce - 1);
        }
      }
    } else {
      if (state.onCall) {
        onCallDetected();
        noCallCount = 0;
      } else {
        noCallCount++;
        if (noCallCount >= 3) {
          onCallEnded();
          noCallCount = 0;
        }
      }
    }
  }

  checkInterval = setInterval(tick, 2000);

  document.addEventListener('visibilitychange', () => {
    // Keep checking even if tab is hidden
  });

  window.addEventListener('beforeunload', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });

  console.log('[WFM Call Timer] Content script loaded v2.6 on', location.hostname, isLSA ? '(LSA InterpreCloud detected)' : '');
})();
