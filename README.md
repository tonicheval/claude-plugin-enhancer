# Claude Plugin Enhancer & Status Bar 🚀

A standardized, one-click installer utility to enhance and patch the official Anthropic Claude Code extension inside VS Code-based editors (Void, Cursor, VS Code).

---

### 📋 Verified & Tested Version:
* **Claude Code Extension Version:** `2.1.280` — verified 23 Sep 2026 in Void, restarting after each rollout stage (see [Upgrading to a new Claude Code version](#-upgrading-to-a-new-claude-code-version))
* **Previous:** `2.1.220` (Released July 29, 2026)
* **Status:** `Active & Verified`

> [!NOTE]
> **Dear Anthropic, re: 2.1.280** — Congratulations on shipping **session groups**! Named, collapsible, drag-and-drop. Gorgeous. It's almost exactly what our `[GroupName]` folders (P11) have been doing since May, so we retired P11 and taught P15 to feed *your* groups instead. And the session list is finally always on — P1, also retired. Two patches down. We're so proud of you. 🥲
>
> Then we restarted and **every shared chat vanished.** Fifteen of them. Not an error, not a warning, not one line in any log — just gone. Turns out 2.1.280 guards the session reader against symlinks with `lstat().isFile()`, which on Windows is `false` for every symlink ever made. Security hardening so thorough it hardened our chats right out of existence. P12_follow lets them back in (only if they point inside `~/.claude/projects`, relax, the hardening still works on everyone else).
>
> Then your shiny new **auto-archive** stored the archive list *globally* and the groups *per project*, so one project's sweep hid our shared chats in every other project and quietly evicted them from their groups. P14 says no.
>
> Also: renaming the `activate()` context parameter from `e` to `$` between builds is a bold minification choice, and it cost us an outage and a very long morning (the second outage was our own PowerShell, in fairness). P8 now reads the name out of your own code, so go ahead, call it `ಠ_ಠ` next time. We'll cope.
>
> And the realpath saga lives on: `realpathSync` still appears 20 times in `extension.js`, including inside `FK()`, where you carefully gated the NFC normalisation to macOS and then realpath'd on Windows anyway. P2_fk is standing by. 😉
>
> P.S. Nice new drive-letter fallback for mapped drives (`Ly$`)! Shame about `\\server\share`: your CLI files chats under the share root *with* its trailing backslash, your list reads it back *without*, and a whole project comes up empty. P3_unc adds the backslash back. We've been doing trailing-slash archaeology on UNC paths since July; happy to lend a brush.
>
> ---
>
> *Previous letter (2.1.220):*
>
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

4. **🔗 Shared Chats — `[s]` (P12\*, `sync-shared.ps1`)**
   * Rename a chat to `[s] title`. On the next editor start, `sync-shared.ps1` (launched by P8 on activation) moves it to `~/.claude/projects/General/`, strips the `[s]`, and symlinks it into **every** project, so it appears in all workspaces.
   * Shared chats are shown in *italics* (P12_ext + P12_wjs_a/b/c).
   * **P12_follow** — 2.1.280 added symlink hardening to the session reader (`lstat().isFile()` on Windows), which silently hid **every** shared chat. P12_follow lets a symlink through only if it resolves to a regular file inside `~/.claude/projects`; any other symlink is still refused.
   * Symlink creation needs Windows Developer Mode or an elevated shell.

5. **📁 Folder Groups — `[Name]` (P15)**
   * Rename a chat to `[Name] title` and it is moved into the native session group **Name** (created if needed, matched case-insensitively), and the `[Name]` prefix is removed from the title.
   * Combine with sharing: `[s][Name] title` shares **and** groups it.
   * Groups are stored per project by Claude Code, but titles are global. So the group name is written to `~/.claude/folder-groups.json` **before** the prefix is removed, and every project applies it the first time it lists that chat — a shared chat lands in the same group everywhere.
   * Applied once per project; after that, regrouping by hand (drag, "Remove from group") always wins. Typing a **new** `[Name]` moves the chat again, in every project.
   * Dragging a chat into a group is native, per project only, and does not touch the title.
   * Happens on the next session-list load (refresh button, opening the sidebar or a panel, starting/ending a chat, reload) — not the instant you rename.
   * The title change is an appended title record (the extension's own rename); chat files are never rewritten, and the earlier title stays in the file history.

6. **🗄️ Auto-Archive Protection (P14)**
   * 2.1.280 auto-archives chats idle for 14 days (`claudeCode.archiveInactiveSessions`). Archive only **hides** a chat — the file is never deleted.
   * Grouped chats are natively exempt. **P14 also exempts shared chats**: the archive list is global while groups are per project, so without it one project's sweep hid a shared chat everywhere and dropped it out of its group. You can still archive shared chats by hand.

7. **🏷️ Title Healing (P16 — successor to P6)**
   * Every 2.1.x build finds a chat's title by reading only the **first and last 64 KB** of the transcript (still true in 2.1.280 — P6's old 1 MB bump was retired in July on the wrong assumption it had gone native; see [anthropics/claude-code#93115](https://github.com/anthropics/claude-code/issues/93115)). Once a chat grows past its last title record, the list shows the **last prompt** instead, or an older title from the start of the file.
   * 2.1.280 also added a per-chat title sidecar (`<project>/<id>/custom-title.json`) that is consulted before the head — but not every rename path updates it, so it can go stale (P15's prefix strip left `[Void]…` behind in one).
   * P16 remembers titles in `~/.claude/session-titles.json` (seeded by the installer, refreshed free on every list load). When a remembered chat comes back with a missing or different title, or a sidecar disagrees, the transcript's own latest title record decides: it is re-appended if out of reach (modified time kept, so the chat does not jump to the top) and stale sidecars are corrected. No extra reads while everything agrees.
   * Why not just bump the window like P6: that reads up to 2 MB per chat on every list load, and still breaks past 1 MB (chats here reach 50 MB).

8. **ℹ️ Session Info & Size (P8 + P1_session_cmd)**
   * `Claude: Show Session Info & Size` — open the JSONL, copy the session ID or file path, compact. The status bar follows the active chat tab (P13 / P13_panel).

### Patch map (2.1.280)

| Patch | Stage | What it does |
|---|---|---|
| P1 | A | Sessions list visible **before** activation (the view's `when` is only set true inside `activate()`, ~9.5 s into a cold start). Without it the window restore and Custom Void's startup guard cannot land on Claude Code and fall back to Claude Accounts |
| P1_session_cmd | A | Registers the Session Info command in `package.json` |
| P3, P3_cwd | A | Path normalisation for mapped/UNC drives (session folder hashing) |
| P3_unc | A | `\\server\share` workspaces: 2.1.280's lister strips the share root's trailing `\` and searches a folder that does not exist (0 sessions); also search the path as given |
| P3_unc_root | A | The same bug at its source: both copies of 2.1.280's path resolver (host + SDK) keep a share root's trailing `\`, so chats in `\\server\share` projects open with their messages instead of empty |
| P8 | B | Status bar, usage, account switcher, auto-swap, session size, launches `sync-shared.ps1` |
| P2_fk | C | Realpath bypass in 2.1.280's `FK()` helper — **unverified**, only matters on mapped drives |
| P13, P13_panel | C | Feed the active chat to the status bar |
| P12_ext, P12_wjs_a/b/c | C | Mark and italicise shared chats |
| P12_follow | C | List symlinked (shared) chats again |
| P14 | C | Never auto-archive shared chats |
| P15 | C | `[Name]` title → native group |
| P16 | C | Heal chat titles that drifted out of the 64 KB read window; fix stale title sidecars |
| P17 | C | Boot watchdog for chat panels restored on a cold start: some restored webviews never start (a race; a different chat each time; clicking the tab does not revive it). If a visible panel is silent for 8 s its content is reloaded, and 8 s later it is closed and the same chat reopened. Panels that start normally are never touched |
| P_diag | off | Diagnostic only (`ENHANCER_DIAG=1`): traces chat-panel restore to `~/.claude/panel-restore-diag.log` (restore call, first message, visibility, dispose) |

**Retired for 2.1.280:** P11 (the old `[Name]` grouping hack — replaced by native groups via P15). P1 was retired on 23 Sep on the assumption it had gone native and **restored on 24 Sep**: 2.1.280 only enables the sessions list once `activate()` runs, which is too late for a cold start. Lesson: check the state *before* activation, not just after. P2 and P3b no longer match anything on 2.1.280 and report `⊘ n/a`. Features P1–P7 and P9–P10 of the original set have been native since v2.1.206.

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

The installer patches the version the editor's `extensions.json` actually points at (falling back to the newest folder), and exits with code `2` and a `⚠ INSTALLER FINISHED WITH N PATCH FAILURE(S)` banner if any patch did not go in. `✔ injected` still only means *injected* — only a restart proves a patch works.

---

## 🔼 Upgrading to a New Claude Code Version

Claude Code in the editor runs *through* this extension. If `activate()` throws, the whole extension is marked failed — status bar, account switcher, session list **and the agent itself** — so a bad patch locks you out of Claude. Bring a new version up in stages, restarting and checking the screen after each:

| Stage | Command | Check on screen after restart |
|---|---|---|
| **A** | `install.bat A` | Agent answers, session list shows; right column opens on **Claude Code**, not Claude Accounts |
| **B** | `install.bat B` | Status bar usage, account swap, Session Info |
| **C** | `install.bat C` (or plain `install.bat`) | Shared chats listed in italics and open with history; `[Name]` chats grouped |

Stages are cumulative. Commit installer changes only after stage C is confirmed on screen.

**Restart = cold start.** Close *every* window so the app fully exits, then reopen. A window reload hides startup-only bugs (on 24 Sep the Claude Code tab regression only showed on a cold start).

**Check every kind of workspace, not just the one you are in.** Each broke differently on 2.1.280:

| Workspace | Example | What to check |
|---|---|---|
| Local drive | `C:\AG Junction\GetHome` | Chats list and open |
| Mapped drive | `Q:\` (RaiDrive) | Chats list and open |
| UNC share root | `\\192.168.1.120\3D Total` | Chats list **and open with their messages** (P3_unc / P3_unc_root) |

**Safety built in:**
* P8 and the P13/P15 hooks are wrapped in `try/catch` — a throw degrades that feature and is logged as `[enhancer] …` instead of killing activation.
* Minified names change every build. Patches capture them from the surrounding code (P8 binds the ExtensionContext it finds, e.g. `e` in 2.1.220, `$` in 2.1.280); P15 only calls the extension's **named** methods.

**When something is wrong, read the logs first — they rotate quickly.** For the custom Void build they are in `%APPDATA%\code-oss-dev\logs\<newest folder by name>\` (not `%APPDATA%\Void\logs`):
* `window*\exthost\exthost.log` → `Activating extension Anthropic.claude-code failed` (a patch broke activation)
* `window*\renderer.log` → `[enhancer] …` (a guarded patch failed and degraded)
* `sharedprocess.log` / `renderer.log` → `Invalid extensions content` (see below)

> [!CAUTION]
> **Never write `extensions.json` or `.obsolete` with PowerShell** (`ConvertTo-Json` / `Set-Content`). It turns the one-element array into a bare object and adds a BOM; the editor then rejects the file and loads **no extensions at all** — indistinguishable from a patch failure unless you read the logs. This caused the second 2.1.280 outage on 23 Sep 2026. Use `node` for any edit. The installer now refuses to run on an invalid registry.
>
> Also note that the editor **deletes folders listed in `.obsolete` at startup**, so keep a snapshot of a known-good build outside the extensions folder before rolling back.

**Back to a clean base camp** (removes all patches, keeps the version):
```powershell
Get-ChildItem "$env:USERPROFILE\.void-editor\extensions\anthropic.claude-code-<version>-win32-x64" -Recurse -Filter *.bak-v<version>-clean |
  % { Copy-Item $_.FullName ($_.FullName -replace '\.bak-v[\d.]+-clean$','') -Force }
```

## 🛡️ Chat Safety

Chats must survive anything. As verified against 2.1.280:
* Nothing in the extension or these patches deletes a local chat file. Archive only hides a chat, and the extension's "delete session" path applies to remote/cloud sessions only.
* The CLI's own transcript cleanup is disabled by the installer (`cleanupPeriodDays = 9999` in `~/.claude/settings.json`).
* Updating the extension deletes the old extension folder — nothing of value is stored there (only the `.bak-v*-clean` copies, which can be re-downloaded).
* Every write these patches make to a chat file is an **append** (title records). Nothing rewrites or truncates a transcript.
* `backup-sessions.ps1` (scheduled task `ClaudeSessionBackup`, daily 03:00) copies every real session file to `~/.claude/projects/backup/sessions/` and `Q:\.claude-session-backup\`. Known gaps: its git commit/push step never runs (`Q:\` is not a git repo), each run overwrites the previous copy, and session subfolders are only copied once.

---

## Folder Structure

* `install.js` — The master Node.js installer and regex patch engine. `ENHANCER_STAGE=A|B|C` selects the rollout stage (default `C`).
* `install.bat` — The one-click Windows shortcut launcher. Optional argument: the stage (`install.bat A`).
* `sync-shared.ps1` — Shared-chat sync (`[s]` → `General\` + symlinks). Deployed to `~/.claude/projects/` by the installer; the repo copy is the source of truth.
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
| `~/.claude/folder-groups.json` | P15: chat ID → group name, and which projects have applied it. The only record of a stripped `[Name]`; a corrupt copy is set aside as `.corrupt-<time>`, never overwritten |
| `~/.claude/session-titles.json` | P16: chat ID → last known custom title (a hint to check the transcript; the transcript always wins). A corrupt copy is set aside as `.corrupt-<time>` |
| `<project>/<id>/custom-title.json` | 2.1.280's native title sidecar; P16 corrects stale ones, never creates them |
| `~/.claude/projects/General/` | Real files of shared chats; each project folder holds symlinks to them |
| Editor state (`globalState`) | Native groups (`sessionGroups:<project>`, per project) and the archive list (`hiddenSessionIds`, global) |

---

*Enhancer package built with care for developer workflow optimization.*
