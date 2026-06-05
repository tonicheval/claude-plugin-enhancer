const ORG_ID = "{{ORG_ID}}";

async function fetchUsage() {
  console.log("[ClaudeUsage] fetching...");
  try {
    const r = await fetch(`https://claude.ai/api/organizations/${ORG_ID}/usage`, {
      credentials: "include",
      headers: { "anthropic-client-platform": "web_claude_ai" }
    });
    console.log("[ClaudeUsage] status:", r.status);
    if (!r.ok) return;
    const data = await r.json();
    console.log("[ClaudeUsage] sending to background");
    chrome.runtime.sendMessage({ type: "usage", data });
  } catch (e) { console.log("[ClaudeUsage] error:", e.message); }
}

fetchUsage();
setInterval(fetchUsage, 5 * 60 * 1000);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "fetch_usage") {
    console.log("[ClaudeUsage] received fetch_usage command from background");
    fetchUsage();
  }
});
