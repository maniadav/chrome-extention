/**
 * Spotify Ad Skipper — Popup Script
 *
 * Manages the toggle state and displays skip count.
 */

document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.getElementById("toggle-btn");
  const statusText = document.getElementById("status-text");
  const skipCount = document.getElementById("skip-count");

  loadState();

  toggleBtn.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "TOGGLE_STATE" });
    updateUI(response.isEnabled);
  });

  async function loadState() {
    const result = await chrome.storage.local.get([
      "adSkipperEnabled",
      "skipCount",
    ]);
    const isEnabled = result.adSkipperEnabled ?? true;
    const count = result.skipCount ?? 0;

    updateUI(isEnabled);
    skipCount.textContent = count;
  }

  function updateUI(isEnabled) {
    toggleBtn.classList.toggle("active", isEnabled);
    statusText.textContent = isEnabled ? "Enabled" : "Disabled";
    statusText.style.color = isEnabled ? "#1DB954" : "#b3b3b3";
  }
});
