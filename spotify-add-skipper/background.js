/**
 * Spotify Ad Skipper — Background Service Worker
 *
 * Handles tab refresh requests from the content script
 * and manages the extension badge/state.
 */

const STORAGE_KEY = "adSkipperEnabled";
const REFRESH_COOLDOWN_MS = 5000;

/** Track per-tab cooldown to prevent rapid re-refreshes */
const recentRefreshes = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [STORAGE_KEY]: true });
  updateBadge(true);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "AD_DETECTED" && sender.tab?.id) {
    handleAdDetected(sender.tab.id);
    sendResponse({ status: "refreshing" });
    return true;
  }

  if (message.type === "GET_STATE") {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      sendResponse({ isEnabled: result[STORAGE_KEY] ?? true });
    });
    return true;
  }

  if (message.type === "TOGGLE_STATE") {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const newState = !(result[STORAGE_KEY] ?? true);
      chrome.storage.local.set({ [STORAGE_KEY]: newState });
      updateBadge(newState);
      sendResponse({ isEnabled: newState });

      // Notify all Spotify tabs about the state change
      broadcastStateChange(newState);
    });
    return true;
  }

  if (message.type === "AD_SKIPPED") {
    incrementSkipCount();
    sendResponse({ status: "ok" });
    return true;
  }
});

async function handleAdDetected(tabId) {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!(result[STORAGE_KEY] ?? true)) return;

  // Prevent rapid re-refreshes on the same tab
  const now = Date.now();
  const lastRefresh = recentRefreshes.get(tabId) ?? 0;
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) return;
  recentRefreshes.set(tabId, now);

  // Set flag so content script auto-plays after reload
  await chrome.storage.local.set({ pendingAutoPlay: true });

  chrome.tabs.reload(tabId);
}

function updateBadge(isEnabled) {
  chrome.action.setBadgeText({ text: isEnabled ? "ON" : "OFF" });
  chrome.action.setBadgeBackgroundColor({
    color: isEnabled ? "#1DB954" : "#666666",
  });
}

async function incrementSkipCount() {
  const result = await chrome.storage.local.get("skipCount");
  const count = (result.skipCount ?? 0) + 1;
  await chrome.storage.local.set({ skipCount: count });
}

async function broadcastStateChange(isEnabled) {
  const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/*" });
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        type: "STATE_CHANGED",
        isEnabled,
      }).catch(() => {
        // Tab may not have content script loaded yet
      });
    }
  }
}
