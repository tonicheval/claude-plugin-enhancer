const PORT = 54321;
const ORG_ID = "{{ORG_ID}}";

// Helper to post data to localhost server
async function postToLocalhost(data) {
  try {
    const r = await fetch(`http://localhost:${PORT}/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    console.log("[ClaudeUsage] background POST status:", r.status);
  } catch (e) {
    console.log("[ClaudeUsage] background POST error:", e.message);
  }
}

// Helper to set cookie headers dynamically using declarativeNetRequest session rules
async function setCookieRule(cookieString) {
  const ruleId = 1;
  const rule = {
    id: ruleId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "Cookie",
          operation: "set",
          value: cookieString
        }
      ]
    },
    condition: {
      urlFilter: `https://claude.ai/api/organizations/${ORG_ID}/usage`,
      resourceTypes: ["xmlhttprequest"]
    }
  };

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [rule]
    });
    console.log("[ClaudeUsage] declarativeNetRequest rule set successfully");
  } catch (e) {
    console.error("[ClaudeUsage] failed to set declarativeNetRequest rule:", e.message);
  }
}

async function removeCookieRule() {
  const ruleId = 1;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId]
    });
    console.log("[ClaudeUsage] declarativeNetRequest rule removed successfully");
  } catch (e) {
    console.error("[ClaudeUsage] failed to remove declarativeNetRequest rule:", e.message);
  }
}

async function getCookiesString() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "claude.ai" }, (cookies) => {
      if (!cookies || cookies.length === 0) {
        resolve("");
        return;
      }
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
      resolve(cookieStr);
    });
  });
}

// Background fetching directly from service worker
async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] background fetching starting...");
  try {
    const cookieStr = await getCookiesString();
    if (cookieStr) {
      await setCookieRule(cookieStr);
    } else {
      console.log("[ClaudeUsage] No cookies found for claude.ai");
    }

    const r = await fetch(`https://claude.ai/api/organizations/${ORG_ID}/usage`, {
      credentials: "include",
      headers: { "anthropic-client-platform": "web_claude_ai" }
    });
    console.log("[ClaudeUsage] background fetch status:", r.status);
    
    if (cookieStr) {
      await removeCookieRule();
    }

    if (!r.ok) return;
    const data = await r.json();
    console.log("[ClaudeUsage] background fetched successfully, posting...");
    await postToLocalhost(data);
  } catch (e) {
    console.log("[ClaudeUsage] background fetch error:", e.message);
    await removeCookieRule();
  }
}

// 1. Listen for messages from content.js (for instant updates if user is actively browsing claude.ai)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "usage") {
    console.log("[ClaudeUsage] message received from content script, posting...");
    postToLocalhost(msg.data);
  }
});

// 2. Set up alarms to run in the background (even when minimized or tabs sleep)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") {
    console.log("[ClaudeUsage] background alarm fired");
    fetchAndPostUsage();
  }
});

// Create alarm on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  console.log("[ClaudeUsage] alarm created on install");
  fetchAndPostUsage();
});

// Create alarm on startup
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  console.log("[ClaudeUsage] alarm created on startup");
  fetchAndPostUsage();
});
