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

// Background fetching directly from service worker
async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] background fetching starting...");
  try {
    const r = await fetch(`https://claude.ai/api/organizations/${ORG_ID}/usage`, {
      credentials: "include",
      headers: { "anthropic-client-platform": "web_claude_ai" }
    });
    console.log("[ClaudeUsage] background fetch status:", r.status);
    if (!r.ok) return;
    const data = await r.json();
    console.log("[ClaudeUsage] background fetched successfully, posting...");
    await postToLocalhost(data);
  } catch (e) {
    console.log("[ClaudeUsage] background fetch error:", e.message);
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
