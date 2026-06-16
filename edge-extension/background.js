const PORT = 54321;
const ORG_ID = "{{ORG_ID}}";

// Check if Void Editor's status bar server is currently running
async function isVoidRunning() {
  try {
    await fetch(`http://localhost:${PORT}/usage`, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-cache"
    });
    return true;
  } catch (e) {
    console.log("[ClaudeUsage] Void not running:", e.message);
    return false;
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

// Wait for a tab to finish loading (resolves when status === "complete")
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);

    // Check if already complete
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// The actual usage-fetching logic, injected directly into a claude.ai tab.
function injectedFetchUsage(orgId) {
  return fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
    credentials: "include",
    headers: { "anthropic-client-platform": "web_claude_ai" }
  })
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
}

// Tier 1: Direct Service Worker Fetch
async function directFetch() {
  const r = await fetch(`https://claude.ai/api/organizations/${ORG_ID}/usage`, {
    credentials: "include",
    headers: { "anthropic-client-platform": "web_claude_ai" }
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] === alarm triggered ===");

  try {
    // Check if Void is running
    const running = await isVoidRunning();
    if (!running) {
      console.log("[ClaudeUsage] Void not running, skipping.");
      return;
    }

    /*
    // TIER 1: Direct Fetch (Commented out as per user request)
    try {
      console.log("[ClaudeUsage] Attempting Tier 1: Direct Fetch...");
      const data = await directFetch();
      console.log("[ClaudeUsage] Tier 1 Success! Got usage data directly. Posting to localhost...");
      await postToLocalhost(data);
      console.log("[ClaudeUsage] === Success! ===");
      return; // Done!
    } catch (e) {
      console.log("[ClaudeUsage] Tier 1 Direct Fetch failed (e.g. Cloudflare):", e.message);
    }

    // TIER 2: Tab Injection Fallback (Commented out as per user request)
    console.log("[ClaudeUsage] Attempting Tier 2: Tab Injection Fallback...");
    let tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
    if (tabs && tabs.length > 0) {
      let tabId = tabs[0].id;
      console.log("[ClaudeUsage] Tier 2: Reusing existing tab:", tabId);
      
      // Inject the fetch directly using chrome.scripting.executeScript
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedFetchUsage,
        args: [ORG_ID],
        world: "MAIN" 
      });

      if (results && results[0] && results[0].result) {
        const data = results[0].result;
        console.log("[ClaudeUsage] Got usage data from tab! Posting to localhost...");
        await postToLocalhost(data);
        console.log("[ClaudeUsage] === Success! ===");
        return;
      }
    }
    */

    // TIER 3: Visible Window Creation (Current method, modified to be visible)
    console.log("[ClaudeUsage] Tier 3: Creating VISIBLE window to bypass occlusion throttling...");
    let tabId;
    let windowId = null;
    
    // Create a small but fully visible window to avoid Chromium throttling
    const win = await chrome.windows.create({
      url: "https://claude.ai/",
      state: "normal",
      // Positioned normally on-screen so it's not occluded
      width: 400,
      height: 400,
      focused: true // Ensures it gets priority and loads instantly
    });
    tabId = win.tabs[0].id;
    windowId = win.id;
    console.log("[ClaudeUsage] Created visible tab:", tabId, "in window:", windowId);

    // Wait for the tab to be fully loaded
    await waitForTabLoad(tabId);
    console.log("[ClaudeUsage] Tab loaded, injecting script...");

    // Inject the fetch directly using chrome.scripting.executeScript
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectedFetchUsage,
      args: [ORG_ID],
      world: "MAIN" 
    });

    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      console.log("[ClaudeUsage] Got usage data from tab! Posting to localhost...");
      await postToLocalhost(data);
      console.log("[ClaudeUsage] === Success! ===");
    } else {
      console.log("[ClaudeUsage] No data returned from inject. Results:", JSON.stringify(results));
    }

    // Clean up the window
    if (windowId) {
      setTimeout(() => {
        chrome.windows.remove(windowId).catch(() => {});
        console.log("[ClaudeUsage] Cleaned up visible window:", windowId);
      }, 1000); // Quick cleanup
    }

  } catch (e) {
    console.log("[ClaudeUsage] Error:", e.message);
  }
}

// Also still accept data from content script (for when user has claude.ai open)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "usage") {
    console.log("[ClaudeUsage] Received usage data from content script");
    postToLocalhost(msg.data);
  }
});

// Alarm handler
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") {
    fetchAndPostUsage();
  }
});

// Setup alarm on install
chrome.runtime.onInstalled.addListener(() => {
  console.log("[ClaudeUsage] Extension installed/updated");
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 2 });
  setTimeout(fetchAndPostUsage, 5000);
});

// Setup alarm on browser startup
chrome.runtime.onStartup.addListener(() => {
  console.log("[ClaudeUsage] Browser started");
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 2 });
  setTimeout(fetchAndPostUsage, 5000);
});
