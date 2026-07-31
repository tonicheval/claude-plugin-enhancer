# Claude Plugin Enhancer & Status Bar 🚀

A standardized, one-click installer utility to enhance and patch the official Anthropic Claude Code extension inside VS Code-based editors (Void, Cursor, VS Code).

---

### 📋 Verified & Tested Version:
* **Claude Code Extension Version:** `2.1.220` (Released July 29, 2026)
* **Status:** `Active & Verified`

> [!NOTE]  
> **Dear Anthropic:** You're welcome. It only took you two months to realize our manual patches for the custom title overrides, race conditions, and 1MB buffer chunk bugs were the correct fixes. 
> But you STILL haven't figured out that Node's `fs.realpathSync()` catastrophically fails or appends slashes on UNC Network Shares (`\\server\share`). Thanks for forcing us to keep writing `P3` and `P3b` patches to bypass your buggy `Tse` and `Kie` realpath hashing logic! Feel free to borrow our fix for the next release. 😉

---

## 💻 Multi-IDE Support (VS Code, Cursor, Windsurf)

Because VS Code, Cursor, and Windsurf all share the identical extension engine and folder structures, this patcher can easily work across any editor! 

The installer script automatically scans and detects where your active editor stores its extensions in this order:
1. **Void Editor:** `~/.void-editor/extensions/`
2. **VS Code:** `~/.vscode/extensions/`
3. **Cursor:** `~/.cursor/extensions/`

Simply run the installer and it will configure the patched files for whichever editor extensions are present on your computer!

---

## Key Features

1. **🚀 Multi-Window Claude Usage Status Bar (Patch 8)**
   * Shows a beautiful, live-updating progress bar representing your quota usage:
     `██░░░░░░░░ 24% resets in 1 hr 28 min — Weekly 23%`
   * Instantly visible and clickable on startup, redirecting you straight to `claude.ai/settings/usage`.
   * **No browser required.** Usage is fetched straight from `api.anthropic.com/api/oauth/usage` using the active account's own OAuth token — every 2 minutes, plus immediately on activation. The display repaints every 5s from the on-disk cache.
   * **Regex-Powered Injection:** Built to survive future Anthropic minification updates by dynamically targeting logic instead of exact strings.

2. **👥 Multi-Account Switcher**
   * Status bar item shows the account you are **currently on** (`$(account) Account 1: T1 (29d)`), with the click target and both token expiries in the tooltip.
   * Swapping rotates the OAuth token in `~/.claude/.credentials.json` **and** the cached identity block (`oauthAccount`) in `~/.claude.json`.
   * That second half matters: if both accounts live in the same organisation, `organizationUuid` is identical for both and `oauthAccount.accountUuid` is the *only* field that distinguishes them. Swapping the token alone leaves `/usage` and the account display stuck on the previous account.
   * Per-account usage is cached separately in `usage_account{1,2}.json`. Only the **active** account is polled live — Claude Code only refreshes the live token, so the idle account's stored token would eventually 401. The idle file keeps its last known value.

3. **🛟 Quota Auto-Swap (with guard rails)**
   * At ≥95% the switcher can hop you to the other account automatically and reload.
   * Triggers on `max(five_hour, seven_day)` so an exhausted **weekly** cap counts, not just the 5-hour window.
   * Refuses to hop onto an account that is also ≥95%, and honours a **30-minute cooldown persisted to `~/.claude/.autoswap_state.json`** — on disk specifically because a window reload wipes in-memory state, which is what previously allowed an endless swap/reload loop.
   * Only fires on freshly-fetched data, never on a stale cache left over from the last session.
   * "Cancel Reload" undoes the credential write, since the swap happens *before* the prompt appears.

> [!NOTE]
> **Retired 31 Jul 2026 — the Edge bridge.** Usage used to be scraped by a Microsoft Edge extension that POSTed to `localhost:54321`, on the assumption that `sk-ant-oat01…` tokens could not read the usage endpoint. **That assumption was wrong** — the OAuth token queries `/api/oauth/usage` perfectly well. The bridge also reported whichever account *Edge* was logged into and filed it under whichever account the IDE thought was active, so the counter was reliably wrong after a swap. The boot task that warmed its cache is retired too: it launched Edge at login and then ran `taskkill /f /im msedge.exe`, killing every Edge window you had open. Source is kept under `edge-extension/` for reference; set `DEPLOY_EDGE_EXT=1` to restore both.

*(Note: Features P1-P7, P9-P10 are now fully natively supported by Anthropic as of v2.1.206! We kept our Custom Session Grouping Tags [P11] logic backed up for future optional integrations).*

---

## How to Install or Reapply Patches

Whenever your **editor auto-updates** and wipes the extension directory, you can restore all patches with **zero prompts** and **zero AI required** in under a second:

1. **Close your editor completely.**
2. **Double-click `install.bat`** (or open a terminal in this directory and run `node install.js`).
3. **Open your editor.**
4. Everything is instantly restored!

No browser step any more — the usage counter authenticates with your own OAuth token, so there is nothing to wake up.

> [!WARNING]
> The installer restores each file from a pristine `*.bak-v<version>-clean` copy before patching. If that clean copy is missing for a file, it is created from whatever is on disk **right now** — so re-running against an already-patched file will bake those patches in as the new baseline. Check that `extension.js.bak-v<version>-clean` and `webview/index.js.bak-v<version>-clean` both exist before re-running after a manual edit.

---

## Folder Structure

* `install.js` — The master Node.js installer and regex patch engine.
* `install.bat` — The one-click Windows shortcut launcher.
* `edge-extension/` — Source for the **retired** Edge extension, kept for reference. Not deployed unless `DEPLOY_EDGE_EXT=1`.

## Runtime State Files

| Path | Purpose |
|---|---|
| `~/.claude/.credentials.json` | Live OAuth token (`claudeAiOauth`) + `organizationUuid` |
| `~/.claude/.credentials_account{1,2}.json` | Per-account backups: token, org uuid, **and** `oauthAccount` |
| `~/.claude.json` → `oauthAccount` | Cached identity Claude Code *displays*; swapped alongside the token |
| `~/.claude/.active_account` | `"1"` or `"2"` — which slot is live |
| `~/.claude/usage_account{1,2}.json` | Per-account usage cache |
| `~/.claude/.autoswap_state.json` | Auto-swap cooldown timestamp (survives reloads) |

---

*Enhancer package built with care for developer workflow optimization.*
