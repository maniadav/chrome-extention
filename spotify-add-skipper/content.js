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
    checkInterval = setInterval(checkForAds, CHECK_INTERVAL_MS);
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

  // Supplements polling — catches ad transitions faster via DOM mutations
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

  // Ordered by reliability — short-circuits on first positive signal
  function isAdPlaying() {
    // Most reliable: Spotify sets this attribute on the playbar <aside>
    const nowPlayingBar = document.querySelector(
      '[data-testid="now-playing-bar"]',
    );
    if (nowPlayingBar) {
      const adType = nowPlayingBar.getAttribute("data-testadtype");
      if (adType && adType !== "ad-type-none") return true;
    }

    if (document.querySelector('[data-testid="ad-controls"]')) return true;

    const widget = document.querySelector('[data-testid="now-playing-widget"]');
    if (widget) {
      const label = widget.getAttribute("aria-label") ?? "";
      if (label.toLowerCase() === "advertisement") return true;
    }

    if (document.querySelector('[data-context-item-type="ad"]')) return true;

    // Fallback: ad-specific UI elements that appear in the now-playing area
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

  async function handlePendingAutoPlay() {
    const result = await chrome.storage.local.get("pendingAutoPlay");
    if (!result.pendingAutoPlay) return;

    await chrome.storage.local.remove("pendingAutoPlay");
    await sendMessage({ type: "AD_SKIPPED" });
    await autoPlay();
  }

  async function autoPlay() {
    // Spotify's SPA hydration takes time after reload
    await delay(AUTO_PLAY_DELAY_MS);

    for (let attempt = 0; attempt < MAX_PLAY_RETRIES; attempt++) {
      const playButton = findPlayButton();
      if (playButton) {
        // Prevent double-click if player already resumed on its own
        const label = playButton.getAttribute("aria-label") ?? "";
        if (label.toLowerCase() === "play") {
          playButton.click();
          return;
        }
        if (label.toLowerCase() === "pause") return;
      }
      await delay(PLAY_RETRY_DELAY_MS);
    }
  }

  function findPlayButton() {
    return document.querySelector('[data-testid="control-button-playpause"]');
  }

  // Swallow errors — extension context can invalidate after reload
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
