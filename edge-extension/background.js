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

    let phase1Success = false;

    // TIER 1: Use an EXISTING claude.ai tab if you already have one open AND it's not sleeping
    let claudeTabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
    let activeClaudeTabs = claudeTabs.filter(t => !t.discarded);

    if (activeClaudeTabs && activeClaudeTabs.length > 0) {
      const targetTabId = activeClaudeTabs[0].id;
      console.log("[ClaudeUsage] Phase 1: Attempting to reuse existing tab:", targetTabId);
      
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
        const scriptPromise = chrome.scripting.executeScript({
          target: { tabId: targetTabId },
          func: injectedFetchUsage,
          args: [ORG_ID],
          world: "MAIN" 
        });

        const results = await Promise.race([scriptPromise, timeoutPromise]);
        
        if (results && results[0] && results[0].result) {
          console.log("[ClaudeUsage] Phase 1 Success! Got usage data.");
          await postToLocalhost(results[0].result);
          phase1Success = true;
        } else {
          console.log("[ClaudeUsage] Phase 1 returned no data.");
        }
      } catch (err) {
        console.log("[ClaudeUsage] Phase 1 Failed (tab frozen or error):", err.message);
      }
    }

    // TIER 2: If Phase 1 failed or no active tabs exist, create a new visible window
    if (!phase1Success) {
      console.log("[ClaudeUsage] Phase 2: Creating new visible window as fallback...");
      const win = await chrome.windows.create({
        url: "https://claude.ai/",
        state: "normal",
        width: 400,
        height: 400,
        focused: true
      });
      createdTabId = win.tabs[0].id;
      createdWindowId = win.id;
      
      console.log("[ClaudeUsage] Waiting for new tab to load...");
      await waitForTabLoad(createdTabId);
      console.log("[ClaudeUsage] Tab loaded. Injecting script...");

      const results = await chrome.scripting.executeScript({
        target: { tabId: createdTabId },
        func: injectedFetchUsage,
        args: [ORG_ID],
        world: "MAIN" 
      });

      if (results && results[0] && results[0].result) {
        console.log("[ClaudeUsage] Phase 2 Success! Got usage data.");
        await postToLocalhost(results[0].result);
      } else {
        console.log("[ClaudeUsage] Phase 2 returned no data.");
      }
    }

  } catch (e) {
    console.log("[ClaudeUsage] Unexpected Error:", e.message);
  } finally {
    // CRITICAL: Cleanup MUST happen in the finally block so it ALWAYS runs
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
