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

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] === alarm triggered ===");

  let createdTabId = null;
  let createdWindowId = null;

  try {
    // Check if Void is running
    const running = await isVoidRunning();
    if (!running) {
      console.log("[ClaudeUsage] Void not running, skipping.");
      return;
    }

    let targetTabId = null;
    let needsToWait = false;

    // TIER 1: Use an EXISTING claude.ai tab if you already have one open AND it's not sleeping
    let claudeTabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
    let activeClaudeTabs = claudeTabs.filter(t => !t.discarded);

    if (activeClaudeTabs && activeClaudeTabs.length > 0) {
      targetTabId = activeClaudeTabs[0].id;
      console.log("[ClaudeUsage] Phase 1: Reusing existing active claude.ai tab:", targetTabId);
    } 
    else {
      // TIER 2: No active claude.ai tab exists, create a new visible window
      console.log("[ClaudeUsage] Phase 2: No active claude tabs open (or they are sleeping). Creating new visible window...");
      const win = await chrome.windows.create({
        url: "https://claude.ai/",
        state: "normal",
        width: 400,
        height: 400,
        focused: true
      });
      createdTabId = win.tabs[0].id;
      createdWindowId = win.id;
      targetTabId = win.tabs[0].id;
      needsToWait = true;
    }

    // Wait for the newly created tab to load (if we created one)
    if (needsToWait) {
      console.log("[ClaudeUsage] Waiting for new tab to load...");
      await waitForTabLoad(targetTabId);
      console.log("[ClaudeUsage] Tab loaded.");
    }

    console.log("[ClaudeUsage] Injecting fetch script...");
    
    // Inject the fetch directly using chrome.scripting.executeScript, wrapped in a 10s timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Script injection timed out (tab might be frozen)")), 10000));
    const scriptPromise = chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: injectedFetchUsage,
      args: [ORG_ID],
      world: "MAIN" 
    });

    const results = await Promise.race([scriptPromise, timeoutPromise]);

    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      console.log("[ClaudeUsage] Got usage data! Posting to localhost...");
      await postToLocalhost(data);
      console.log("[ClaudeUsage] === Success! ===");
    } else {
      console.log("[ClaudeUsage] No data returned from inject. Results:", JSON.stringify(results));
    }

  } catch (e) {
    console.log("[ClaudeUsage] Error:", e.message);
  } finally {
    // CRITICAL: Cleanup MUST happen in the finally block so it ALWAYS runs
    // even if Cloudflare blocks the request or the tab times out!
    setTimeout(() => {
      if (createdWindowId) {
        chrome.windows.remove(createdWindowId).catch(() => {});
        console.log("[ClaudeUsage] Cleaned up new window:", createdWindowId);
      } else if (createdTabId) {
        chrome.tabs.remove(createdTabId).catch(() => {});
        console.log("[ClaudeUsage] Cleaned up background tab:", createdTabId);
      }
    }, 1000); // Quick cleanup
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
