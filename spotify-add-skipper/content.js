/**
 * Spotify Ad Skipper — Content Script
 *
 * Monitors the Spotify web player DOM for ad indicators.
 * When an ad is detected, notifies the background script to refresh.
 * After a refresh, auto-clicks the play button to resume music.
 *
 * Detection signals derived from real Spotify DOM:
 *   - data-testadtype="ad-type-ad" on the now-playing bar <aside>
 *   - data-testid="ad-controls" on the player controls container
 *   - aria-label="Advertisement" on the now-playing widget
 *   - data-testid="ad-link" anchors in the now-playing widget
 *   - data-context-item-type="ad" on the context link
 */

(() => {
  const CHECK_INTERVAL_MS = 1000;
  const AUTO_PLAY_DELAY_MS = 3000;
  const MAX_PLAY_RETRIES = 15;
  const PLAY_RETRY_DELAY_MS = 1000;

  let isMonitoring = false;
  let checkInterval = null;
  let observer = null;

  init();

  async function init() {
    const response = await sendMessage({ type: "GET_STATE" });
    if (!response?.isEnabled) return;

    await handlePendingAutoPlay();
    startMonitoring();
  }

  function startMonitoring() {
    if (isMonitoring) return;
    isMonitoring = true;

    // Interval-based polling as the reliable baseline
    checkInterval = setInterval(checkForAds, CHECK_INTERVAL_MS);

    // MutationObserver for faster detection when the now-playing bar updates
    observeNowPlayingBar();
  }

  function stopMonitoring() {
    isMonitoring = false;

    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }

    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  /**
   * Watch the now-playing bar for attribute/child changes.
   * Falls back gracefully if the bar isn't in the DOM yet.
   */
  function observeNowPlayingBar() {
    const bar = document.querySelector('[data-testid="now-playing-bar"]');
    if (!bar) return;

    observer = new MutationObserver(() => {
      if (isMonitoring) checkForAds();
    });

    observer.observe(bar, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-testadtype", "aria-label", "data-testid"],
    });
  }

  function checkForAds() {
    if (isAdPlaying()) {
      stopMonitoring();
      notifyAdDetected();
    }
  }

  /**
   * Layered ad detection using real Spotify DOM attributes.
   * Returns true at the first positive signal — ordered by reliability.
   */
  function isAdPlaying() {
    // Signal 1 (strongest): data-testadtype attribute on the now-playing bar
    const nowPlayingBar = document.querySelector(
      '[data-testid="now-playing-bar"]'
    );
    if (nowPlayingBar) {
      const adType = nowPlayingBar.getAttribute("data-testadtype");
      if (adType && adType !== "ad-type-none") return true;
    }

    // Signal 2: ad-specific controls container
    if (document.querySelector('[data-testid="ad-controls"]')) return true;

    // Signal 3: now-playing widget with aria-label="Advertisement"
    const widget = document.querySelector(
      '[data-testid="now-playing-widget"]'
    );
    if (widget) {
      const label = widget.getAttribute("aria-label") ?? "";
      if (label.toLowerCase() === "advertisement") return true;
    }

    // Signal 4: context link with data-context-item-type="ad"
    if (document.querySelector('[data-context-item-type="ad"]')) return true;

    // Signal 5: ad-specific test IDs in the now-playing area
    if (
      document.querySelector('[data-testid="ad-link"]') ||
      document.querySelector('[data-testid="button-like-ad"]') ||
      document.querySelector('[data-testid="button-dislike-ad"]') ||
      document.querySelector('[data-testid="context-item-info-ad-subtitle"]')
    ) {
      return true;
    }

    return false;
  }

  function notifyAdDetected() {
    sendMessage({ type: "AD_DETECTED" });
  }

  /**
   * After a page refresh triggered by ad detection,
   * wait for the player to load and click play.
   */
  async function handlePendingAutoPlay() {
    const result = await chrome.storage.local.get("pendingAutoPlay");
    if (!result.pendingAutoPlay) return;

    await chrome.storage.local.remove("pendingAutoPlay");
    await sendMessage({ type: "AD_SKIPPED" });
    await autoPlay();
  }

  async function autoPlay() {
    await delay(AUTO_PLAY_DELAY_MS);

    for (let attempt = 0; attempt < MAX_PLAY_RETRIES; attempt++) {
      const playButton = findPlayButton();
      if (playButton) {
        // Only click if the player is paused (aria-label="Play")
        const label = playButton.getAttribute("aria-label") ?? "";
        if (label.toLowerCase() === "play") {
          playButton.click();
          return;
        }
        // Already playing, nothing to do
        if (label.toLowerCase() === "pause") return;
      }
      await delay(PLAY_RETRY_DELAY_MS);
    }
  }

  function findPlayButton() {
    return document.querySelector(
      '[data-testid="control-button-playpause"]'
    );
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, resolve);
      } catch {
        resolve(null);
      }
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Listen for enable/disable toggle from popup while the page is already open
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATE_CHANGED") {
      if (message.isEnabled) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
    }
  });
})();
