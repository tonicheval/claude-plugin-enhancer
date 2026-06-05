const PORT = 54321;
const ORG_ID = "{{ORG_ID}}";

async function postToLocalhost(data) {
  try {
    const r = await fetch(`http://localhost:${PORT}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    console.log("[ClaudeUsage] POST status:", r.status);
  } catch (e) {
    console.log("[ClaudeUsage] POST error:", e.message);
  }
}

// Find or create a claude.ai tab for fetching (only way to bypass Cloudflare)
async function ensureClaudeTab() {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  if (tabs && tabs.length > 0) return tabs[0].id;

  // No claude.ai tab exists - create one in a minimized window
  const win = await chrome.windows.create({
    url: "https://claude.ai/",
    state: "minimized",
    focused: false
  });
  // Return the tab ID from the new window
  return win.tabs[0].id;
}

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] alarm triggered...");
  try {
    const tabId = await ensureClaudeTab();
    console.log("[ClaudeUsage] Using tab:", tabId);

    // Wait a moment for the page to load if it was just created
    await new Promise(r => setTimeout(r, 3000));

    // Send fetch command to the content script in that tab
    chrome.tabs.sendMessage(tabId, { type: "fetch_usage" }, (response) => {
      if (chrome.runtime.lastError) {
        console.log("[ClaudeUsage] Tab not ready yet:", chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.log("[ClaudeUsage] error:", e.message);
  }
}

// Receive usage data from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "usage") {
    console.log("[ClaudeUsage] Received usage data from content script!");
    postToLocalhost(msg.data);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") fetchAndPostUsage();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  // Delay first fetch to let things settle
  setTimeout(fetchAndPostUsage, 5000);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  setTimeout(fetchAndPostUsage, 5000);
});
