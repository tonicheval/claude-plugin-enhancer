# Claude Plugin Enhancer & Status Bar 🚀

A standardized, one-click installer utility to enhance and patch the official Anthropic Claude Code extension inside VS Code-based editors (Void, Cursor, VS Code).

---

### 📋 Verified & Tested Version:
* **Claude Code Extension Version:** `2.1.145` (Released May 21, 2026)
* **Status:** `Active & Verified`

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
   * Shows a beautiful, live-updating progress bar representing your Pro quota usage:
     `██░░░░░░░░ 24% resets in 1 hr 28 min — Weekly 23%`
   * Instantly visible and clickable on startup, redirecting you straight to `claude.ai/settings/usage`.
   * **Multi-Window Syncing:** Avoids port binding conflicts by utilizing a shared local cache (`~/.claude/usage.json`). Whichever window starts first handles background Edge POSTs, while *all* other windows listen and update simultaneously in real-time!
   
2. **🌐 Cloudflare-Bypassing Edge Extension**
   * Uses your active, authenticated Microsoft Edge browser session to fetch quota usage directly from Claude's API under the hood (`credentials: "include"`).
   * Bypasses Cloudflare bot challenges completely.
   * Runs as a service worker using **`chrome.alarms`**, allowing it to wake up and push updates every 5 minutes in the background—even if the browser window is minimized or no `claude.ai` tab is active!

3. **🔄 Silent Startup Automation**
   * Automatically configures a silent background script upon PC boot.
   * Launches Edge minimized, waits 8 seconds for the initial cache refresh, and then shuts Edge down invisibly to ensure your status bar is populated the moment you start working.

4. **📂 Extension Sidebar Fixes**
   * **P1 Sidebar Retention:** Forces the sessions panel sidebar to remain permanently open.
   * **P2/P3 realpath Bypass:** Fixes session history rendering over RaiDrive / UNC mounts.
   * **P4/P5 Live Rename Race Fix:** Prevents freshly renamed sessions from instantly reverting.
   * **P6 1MB Buffer Bump:** Increases history scanning buffers so large chats don't lose their custom names.
   * **P7 Timestamp Sorting:** Ensures sessions sort by your *last actual sent/received conversation* instead of your last click.
   * **P11 Collapsible Grouping:** Enables grouping chats under a `[GroupName] Chat Title` prefix, which organizes them inside a beautiful, collapsible sidebar folder!
   * **P12 italicized renders:** Shared symlinked sessions render their `[GroupName]` folder names in *italics* so you know which chats are shared across multiple workspaces.

---

## How to Install or Reapply Patches

Whenever your **editor auto-updates** and wipes the extension directory, you can restore all patches with **zero prompts** and **zero AI required** in under a second:

1. **Close your editor completely.**
2. **Double-click `install.bat`** (or open a terminal in this directory and run `node install.js`).
3. **Open your editor.**
4. Go to **`edge://extensions`** in Microsoft Edge and click **↺ Reload** on the **Claude Plugin Enhancer** extension to wake up the service worker.
5. Everything is instantly restored!

---

## Folder Structure

* `install.js` — The master Node.js installer and regex patch engine.
* `install.bat` — The one-click Windows shortcut launcher.
* `edge-extension/` — The source files for the Edge extension (manifest, content scripts, background worker).
* `startup/` — Holds clean backup configurations for the background script.

---

*Enhancer package built with care for developer workflow optimization.*
