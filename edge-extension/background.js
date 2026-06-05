const PORT = 54321;
const ORG_ID = "{{ORG_ID}}";

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

async function getCookiesString() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: "claude.ai" }, (cookies) => {
      if (!cookies || cookies.length === 0) return resolve("");
      resolve(cookies.map(c => `${c.name}=${c.value}`).join("; "));
    });
  });
}

async function setSpoofRules(cookieStr) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "cookie", operation: "set", value: cookieStr },
          { header: "origin", operation: "remove" },
          { header: "referer", operation: "set", value: "https://claude.ai/" },
          { header: "sec-fetch-site", operation: "set", value: "same-origin" },
          { header: "sec-fetch-mode", operation: "set", value: "cors" },
          { header: "sec-fetch-dest", operation: "set", value: "empty" }
        ]
      },
      condition: { urlFilter: `*claude.ai/api/organizations/*/usage`, resourceTypes: ["xmlhttprequest", "other"] }
    }]
  });
}

async function fetchAndPostUsage() {
  console.log("[ClaudeUsage] background fetch alarm triggered...");
  const cookieStr = await getCookiesString();
  if (!cookieStr) {
    console.log("[ClaudeUsage] No cookies found!");
    return;
  }
  
  await setSpoofRules(cookieStr);
  
  try {
    const r = await fetch(`https://claude.ai/api/organizations/${ORG_ID}/usage`, {
      credentials: "omit", // We manually inject cookies via DNR
      headers: {
        "anthropic-client-platform": "web_claude_ai",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": `"Chromium";v="130", "Microsoft Edge";v="130", "Not?A_Brand";v="99"`,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": `"Windows"`
      }
    });
    console.log("[ClaudeUsage] background fetch status:", r.status);
    if (!r.ok) return;
    const data = await r.json();
    await postToLocalhost(data);
  } catch (e) {
    console.log("[ClaudeUsage] error:", e.message);
  }
}

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
