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
// This avoids all content-script messaging issues.
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

  try {
    // Step 1: Check if Void is running
    const running = await isVoidRunning();
    if (!running) {
      console.log("[ClaudeUsage] Void not running, skipping.");
      return;
    }
    console.log("[ClaudeUsage] Void is running!");

    // Step 2: Find an existing claude.ai tab, or create one off-screen
    let tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
    let tabId;
    let windowId = null;

    if (tabs && tabs.length > 0) {
      tabId = tabs[0].id;
      console.log("[ClaudeUsage] Reusing existing tab:", tabId);
    } else {
      console.log("[ClaudeUsage] No claude.ai tab, creating off-screen...");
      const win = await chrome.windows.create({
        url: "https://claude.ai/",
        state: "normal",
        left: -3000,
        top: -3000,
        width: 200,
        height: 200,
        focused: false
      });
      tabId = win.tabs[0].id;
      windowId = win.id;
      console.log("[ClaudeUsage] Created tab:", tabId, "in window:", windowId);
    }

    // Step 3: Wait for the tab to be fully loaded
    await waitForTabLoad(tabId);
    console.log("[ClaudeUsage] Tab loaded, injecting script...");

    // Step 4: Inject the fetch directly using chrome.scripting.executeScript
    // This is FAR more reliable than sendMessage to a content script.
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectedFetchUsage,
      args: [ORG_ID],
      world: "MAIN" // Run in the page's context so credentials: "include" works
    });

    if (results && results[0] && results[0].result) {
      const data = results[0].result;
      console.log("[ClaudeUsage] Got usage data! Posting to localhost...");
      await postToLocalhost(data);
      console.log("[ClaudeUsage] === Success! ===");
    } else {
      console.log("[ClaudeUsage] No data returned from inject. Results:", JSON.stringify(results));
    }

    // Step 5: Clean up the off-screen window if we created one
    if (windowId) {
      setTimeout(() => {
        chrome.windows.remove(windowId).catch(() => {});
        console.log("[ClaudeUsage] Cleaned up window:", windowId);
      }, 2000);
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
