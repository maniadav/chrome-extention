const STORAGE_KEY = "adSkipperEnabled";
const REFRESH_COOLDOWN_MS = 5000;

// Prevents content script firing multiple AD_DETECTED before reload completes
const recentRefreshes = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [STORAGE_KEY]: true });
  updateBadge(true);
});

// return true in each branch to keep sendResponse channel open for async replies
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

  // Debounce — content script can detect the same ad multiple times before reload
  const now = Date.now();
  const lastRefresh = recentRefreshes.get(tabId) ?? 0;
  if (now - lastRefresh < REFRESH_COOLDOWN_MS) return;
  recentRefreshes.set(tabId, now);

  // Content script reads this flag after reload to trigger auto-play
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
      // Tabs without injected content script will reject — safe to ignore
      chrome.tabs.sendMessage(tab.id, {
        type: "STATE_CHANGED",
        isEnabled,
      }).catch(() => {});
    }
  }
}
