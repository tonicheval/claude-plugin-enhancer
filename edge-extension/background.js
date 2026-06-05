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

async function getCookiesString() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "claude.ai" }, (cookies) => {
      if (!cookies || cookies.length === 0) return resolve("");
      resolve(cookies.map(c => `${c.name}=${c.value}`).join("; "));
    });
  });
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_SCRAPING"],
    justification: "Fetch claude.ai usage data in background"
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] alarm triggered...");
  const cookieStr = await getCookiesString();
  if (!cookieStr) {
    console.log("[ClaudeUsage] No cookies found!");
    return;
  }
  console.log("[ClaudeUsage] Got cookies, creating offscreen document...");

  await ensureOffscreen();

  const result = await chrome.runtime.sendMessage({
    type: "fetch_usage_offscreen",
    orgId: ORG_ID,
    cookieStr: cookieStr
  });

  if (result && result.data) {
    console.log("[ClaudeUsage] Offscreen fetch succeeded!");
    await postToLocalhost(result.data);
  } else {
    console.log("[ClaudeUsage] Offscreen fetch failed:", result?.error);
  }
}

// Also accept direct usage data from content script (when user is on claude.ai)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "usage") postToLocalhost(msg.data);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetchUsageAlarm") fetchAndPostUsage();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  fetchAndPostUsage();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("fetchUsageAlarm", { periodInMinutes: 5 });
  fetchAndPostUsage();
});
