// offscreen.js - runs inside an invisible offscreen document
// Fetches usage data from claude.ai and sends it back to the background script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetch_usage_offscreen") {
    doFetch(msg.orgId, msg.cookieStr).then(sendResponse);
    return true; // keep message channel open for async response
  }
});

async function doFetch(orgId, cookieStr) {
  try {
    const r = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, {
      credentials: "omit",
      headers: {
        "anthropic-client-platform": "web_claude_ai",
        "cookie": cookieStr
      }
    });
    console.log("[ClaudeUsage offscreen] fetch status:", r.status);
    if (!r.ok) return { error: r.status };
    const data = await r.json();
    return { data };
  } catch (e) {
    console.log("[ClaudeUsage offscreen] error:", e.message);
    return { error: e.message };
  }
}
