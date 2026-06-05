const PORT = 54321;
const ORG_ID = "{{ORG_ID}}";

// Track windows we created so we can auto-close them after fetch
const autoCreatedWindows = new Set();

// Check if Void Editor's status bar server is currently running
async function isVoidRunning() {
  try {
    // We use no-cors to prevent the browser from blocking the check due to CORS.
    // We do not use a short setTimeout because connection refusal on localhost is instant,
    // and background CPU throttling can trigger short timeouts prematurely.
    await fetch(`http://localhost:${PORT}/usage`, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-cache"
    });
    return true;
  } catch (e) {
    console.log("[ClaudeUsage] isVoidRunning check failed:", e.message);
    return false; // Connection refused means Void is closed
  }
}

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
  if (tabs && tabs.length > 0) return { tabId: tabs[0].id, autoCreated: false };

  // No claude.ai tab exists - create one in an off-screen window to prevent visible flashing
  const win = await chrome.windows.create({
    url: "https://claude.ai/",
    state: "normal",
    left: -3000,
    top: -3000,
    width: 200,
    height: 200,
    focused: false
  });

  const windowId = win.id;
  const tabId = win.tabs[0].id;
  autoCreatedWindows.add(windowId);

  // Safety timeout: close the window after 15s no matter what
  // (prevents windows stacking up if fetch fails or user is logged out)
  setTimeout(() => {
    if (autoCreatedWindows.has(windowId)) {
      autoCreatedWindows.delete(windowId);
      chrome.windows.remove(windowId).catch(() => {});
      console.log("[ClaudeUsage] Safety timeout - closed window", windowId);
    }
  }, 15000);

  return { tabId, autoCreated: true, windowId };
}

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] alarm triggered...");
  try {
    // Only fetch if Void is actively running
    const running = await isVoidRunning();
    if (!running) {
      console.log("[ClaudeUsage] Void is not running. Skipping fetch.");
      return;
    }

    const { tabId } = await ensureClaudeTab();
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
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "usage") {
    console.log("[ClaudeUsage] Received usage data from content script!");
    postToLocalhost(msg.data);

    // Auto-close the window if we created it
    if (sender.tab && sender.tab.windowId) {
      const wid = sender.tab.windowId;
      if (autoCreatedWindows.has(wid)) {
        autoCreatedWindows.delete(wid);
        // Small delay to let POST finish
        setTimeout(() => {
          chrome.windows.remove(wid).catch(() => {});
          console.log("[ClaudeUsage] Auto-closed window", wid);
        }, 1000);
      }
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") fetchAndPostUsage();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 2 });
  // Delay first fetch to let things settle
  setTimeout(fetchAndPostUsage, 5000);
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 2 });
  setTimeout(fetchAndPostUsage, 5000);
});
