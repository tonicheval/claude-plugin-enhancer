const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

console.log(`${CYAN}${BOLD}====================================================`);
console.log(`          CLAUDE PLUGIN ENHANCER INSTALLER          `);
console.log(`====================================================${RESET}\n`);

// Staged rollout. Patches are applied cumulatively by risk, so a new Claude Code release can be
// brought up one stage at a time with a restart + on-screen check in between:
//   A  P1, P1_session_cmd, P3, P3_cwd, P3_unc, P3_unc_root  (package.json + path normalisation)
//   B  A + P8                                  (status bar / account switcher IIFE in activate())
//   C  B + P2/P2_fk, P3b, P13*, P12*, P14, P15, P16  (everything - the default)
// Shared chat needs B AND C: P8 spawns sync-shared.ps1 (moves [s] chats to General\ and symlinks
// them into every project), P12_follow lets the list read those symlinks, P12_* mark them italic.
//   ENHANCER_STAGE=A node install.js
const STAGE = (process.env.ENHANCER_STAGE || 'C').toUpperCase();
if (!['A', 'B', 'C'].includes(STAGE)) {
    console.error(`${RED}ENHANCER_STAGE must be A, B or C (got '${STAGE}')${RESET}`);
    process.exit(1);
}
const stage = s => STAGE >= s;

// Anything that is not "✔ Applied" or a known/expected skip lands here, so the final banner
// cannot claim success when a patch did not go in.
const failures = [];

try {
    const homedir = os.homedir();
    console.log(`${BOLD}Stage ${STAGE}${RESET}${STAGE === 'C' ? '' : ` ${YELLOW}(partial rollout - later stages are NOT applied)${RESET}`}\n`);

    console.log(`${BOLD}[1/7] Detecting Claude Code extension folders...${RESET}`);
    const potentialBases = [
        { name: "Void Editor", path: path.join(homedir, '.void-editor', 'extensions') },
        { name: "VS Code", path: path.join(homedir, '.vscode', 'extensions') },
        { name: "Cursor", path: path.join(homedir, '.cursor', 'extensions') }
    ];
    
    const targets = [];
    
    for (const app of potentialBases) {
        if (fs.existsSync(app.path)) {
            // The registry must be a JSON ARRAY. If it is not, the editor rejects it with
            // "Invalid extensions content" and loads NO user extensions at all - which looks
            // exactly like our patches killed activate(). That is what the second 2026-09-23
            // outage actually was: a PowerShell ConvertTo-Json rewrite collapsed the one-element
            // array into a bare object (plus a BOM). Refuse to go on rather than let the next
            // restart fail for a reason nobody will look for in extension.js.
            const regPath = path.join(app.path, 'extensions.json');
            let registered = null;
            if (fs.existsSync(regPath)) {
                let reg;
                try { reg = JSON.parse(fs.readFileSync(regPath, 'utf8').replace(/^﻿/, '').trim() || '[]'); }
                catch (e) { throw new Error(`${app.name}: ${regPath} is not valid JSON (${e.message}). The editor will load NO extensions. Fix it before patching.`); }
                if (!Array.isArray(reg)) throw new Error(`${app.name}: ${regPath} is a JSON ${typeof reg}, not an array. The editor will reject it and load NO extensions. Wrap it in [ ] (and write it without a BOM) before patching.`);
                const entry = reg.find(e => e && e.identifier && String(e.identifier.id).toLowerCase() === 'anthropic.claude-code');
                if (entry && typeof entry.relativeLocation === 'string' && entry.relativeLocation) registered = entry.relativeLocation;
            }

            const dirs = fs.readdirSync(app.path)
                .filter(d => d.startsWith('anthropic.claude-code-') && fs.statSync(path.join(app.path, d)).isDirectory());

            // Patch the build the editor will actually load, not merely the newest folder - old
            // versions are left on disk for rollback and their mtime moves whenever they are touched.
            let pick = null;
            if (registered && dirs.includes(registered)) pick = registered;
            else if (dirs.length > 0) {
                dirs.sort((a, b) => fs.statSync(path.join(app.path, b)).mtimeMs - fs.statSync(path.join(app.path, a)).mtimeMs);
                pick = dirs[0];
                if (registered) console.log(`  ${YELLOW}⚠ ${app.name}: registry points at '${registered}', which is not on disk - falling back to newest folder${RESET}`);
            }
            if (pick) targets.push({ appName: app.name, extVersion: pick, extDir: path.join(app.path, pick) });
        }
    }
    
    if (targets.length === 0) throw new Error("No anthropic.claude-code extension folder found.");
    
    console.log(`  ${GREEN}✔ Detected extension directories to patch:${RESET}`);
    targets.forEach(t => console.log(`    - ${BOLD}${t.appName}${RESET}: ${t.extVersion}`));
    
    console.log(`\n${BOLD}[2/7] Extracting Claude credentials...${RESET}`);
    const credPath = path.join(homedir, '.claude', '.credentials.json');
    if (!fs.existsSync(credPath)) throw new Error(`Claude credentials not found at: ${credPath}.`);
    
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    // ORG_ID is no longer required because the edge extension fetches it dynamically.
    console.log(`  ${GREEN}✔ Credentials validated${RESET}`);
    // [3/7] Edge extension deployment - RETIRED 31 Jul 2026.
    // The counter now fetches usage directly from api.anthropic.com/api/oauth/usage
    // using the active account's own OAuth token (_fetchUsageNow in the P8 IIFE).
    // The browser bridge reported whichever account EDGE was logged into, which got
    // filed under whichever account .active_account named - always wrong after a swap.
    // Source is kept in ./edge-extension/ for reference; set DEPLOY_EDGE_EXT=1 to restore.
    const DEPLOY_EDGE_EXT = process.env.DEPLOY_EDGE_EXT === '1';
    if (DEPLOY_EDGE_EXT) {
        console.log(`\n${BOLD}[3/7] Configuring & deploying Edge extension...${RESET}`);
        const targetEdgeDir = path.join(homedir, '.claude', 'claude-usage-extension');
        if (!fs.existsSync(targetEdgeDir)) fs.mkdirSync(targetEdgeDir, { recursive: true });

        const pkgEdgeDir = path.join(__dirname, 'edge-extension');
        const edgeManifest = fs.readFileSync(path.join(pkgEdgeDir, 'manifest.json'), 'utf8');
        const edgeBg = fs.readFileSync(path.join(pkgEdgeDir, 'background.js'), 'utf8');
        const edgeContent = fs.readFileSync(path.join(pkgEdgeDir, 'content.js'), 'utf8');

        fs.writeFileSync(path.join(targetEdgeDir, 'manifest.json'), edgeManifest, 'utf8');
        fs.writeFileSync(path.join(targetEdgeDir, 'background.js'), edgeBg, 'utf8');
        fs.writeFileSync(path.join(targetEdgeDir, 'content.js'), edgeContent, 'utf8');

        console.log(`  ${GREEN}✔ Deployed Edge Extension to: ${targetEdgeDir}${RESET}`);
    } else {
        console.log(`\n${BOLD}[3/7] Edge extension: ${RESET}${YELLOW}skipped (retired - usage is fetched natively)${RESET}`);
    }
    
    console.log(`\n${BOLD}[4/7] Patching extension code...${RESET}`);
    
    for (const target of targets) {
        const { appName, extDir, extVersion } = target;
        console.log(`\n  ${CYAN}Patching ${appName} (${extVersion})...${RESET}`);
        
        const verMatch = /anthropic\.claude-code-(\d+\.\d+\.\d+)/.exec(extVersion);
        const ver = verMatch ? verMatch[1] : 'latest';
        
        const ejs = path.join(extDir, 'extension.js');
        const wjs = path.join(extDir, 'webview', 'index.js');
        const pkg = path.join(extDir, 'package.json');
        
        const cleanSuffix = `.bak-v${ver}-clean`;
        const ejsClean = `${ejs}${cleanSuffix}`;
        const wjsClean = `${wjs}${cleanSuffix}`;
        const pkgClean = `${pkg}${cleanSuffix}`;
        
        if (!fs.existsSync(ejsClean)) fs.copyFileSync(ejs, ejsClean);
        if (!fs.existsSync(wjsClean)) fs.copyFileSync(wjs, wjsClean);
        if (!fs.existsSync(pkgClean)) fs.copyFileSync(pkg, pkgClean);
        
        fs.copyFileSync(ejsClean, ejs);
        fs.copyFileSync(wjsClean, wjs);
        fs.copyFileSync(pkgClean, pkg);
        
        let ejsContent = fs.readFileSync(ejs, 'utf8');
        let wjsContent = fs.readFileSync(wjs, 'utf8');
        let pkgContent = fs.readFileSync(pkg, 'utf8');
        
        function checkSyntax(file, label) {
            try {
                if (!file.endsWith('.json')) execSync(`node -c "${file}"`, { stdio: 'ignore' });
                else JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch (e) {
                console.error(`      ${RED}✘ Syntax Error after applying: ${label}${RESET}`);
                failures.push(`${appName}: syntax error after ${label}`);
            }
        }

        function applyRegex(fileContent, regex, newStr, label, isOptional = false) {
            if (!regex.test(fileContent)) {
                if (isOptional) {
                    console.log(`      ${YELLOW}⚠ Skipping optional patch (not found): ${label}${RESET}`);
                    return fileContent;
                } else {
                    console.error(`      ${RED}✘ Marker not found: ${label}${RESET}`);
                    failures.push(`${appName}: ${label} - marker not found`);
                    return fileContent;
                }
            }
            let updated = fileContent.replace(regex, newStr);
            console.log(`      ${GREEN}✔ ${label}: Applied${RESET}`);
            return updated;
        }

        // P1: sessions list visible from the first moment, not only after activate().
        // The view's `when` is claude-vscode.sessionsListEnabled, which 2.1.280 sets to true inside
        // activate(). On a cold start that runs ~9.5 s after the window opens, so until then the
        // Claude Code container has NO visible view - the window restore and Custom Void's 6 s
        // "land on Claude Code" guard cannot select it and the bar falls back to Claude Accounts.
        // (Retired by mistake on 2026-09-23 because the post-activation state looked identical;
        // restored 2026-09-24 after the right column kept opening on Claude Accounts.)
        pkgContent = applyRegex(pkgContent, /"when": "claude-vscode.sessionsListEnabled"/g, '"when": "true"', 'P1 (Sessions list visible before activation)');
        fs.writeFileSync(pkg, pkgContent);
        
        if (stage('C')) { // ---- stage C: P2 / P2_fk ----
        // P2: Webview initialization realpathSync bypass (Symlink fix for frontend)
        let p2Found = false;
        ejsContent = ejsContent.replace(/([a-zA-Z0-9_$]+)\.realpathSync\(([a-zA-Z0-9_$]+)\[0\]\|\|([a-zA-Z0-9_$]+)\.homedir\(\)\)\.normalize\("NFC"\)/g, (match, fsVar, p1, p2) => {
            p2Found = true;
            return `(${p1}[0]||${p2}.homedir()).normalize("NFC")`;
        });
        if (p2Found) console.log(`      \x1b[32m✔ P2 (Webview realpath): Applied\x1b[0m`);
        else console.log(`      \x1b[33m⊘ P2 (Webview realpath): pre-2.1.280 shape absent - P2_fk below covers it\x1b[0m`);

        // P2_fk: the 2.1.280+ shape of the SAME fix. P2's target did not disappear, it moved.
        // Anthropic folded `realpathSync(x[0]||homedir()).normalize("NFC")` into a helper:
        //     function FK($){let J=$;try{J=fs.realpathSync($)}catch{}
        //                    return process.platform==="darwin"?J.normalize("NFC"):J}
        // Only the NFC half is darwin-gated - realpathSync still runs on Windows. Everything
        // funnels through it, including `My($){return FK($[0]||homedir())}` (literally old P2)
        // and `sessionListScopeRoot(){...return OV$(FK($))}`. On the Q: RaiDrive mount that
        // resolves to a UNC path, the project folder is encoded from the wrong string, and the
        // session list comes up EMPTY. This is what broke 2.1.280 on 2026-09-23.
        // Strip the realpath, preserve the darwin NFC behaviour exactly.
        let p2fkFound = false, fkName = null;
        ejsContent = ejsContent.replace(/function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{let ([a-zA-Z0-9_$]+)=\2;try\{\3=([a-zA-Z0-9_$]+)\.realpathSync\(\2\)\}catch\{\}return process\.platform==="darwin"\?\3\.normalize\("NFC"\):\3\}/g, (match, fn, arg) => {
            p2fkFound = true; fkName = fn;
            return `function ${fn}(${arg}){return process.platform==="darwin"?${arg}.normalize("NFC"):${arg}}`;
        });
        // sibling that realpaths before delegating to FK
        let p2fk2Found = false;
        if (fkName) {
            const esc = fkName.replace(/\$/g, '\\$');
            const reIj = new RegExp('function ([a-zA-Z0-9_$]+)\\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\\)\\{if\\(!\\2\\)return ' + esc + '\\(\\3\\);try\\{return ' + esc + '\\(([a-zA-Z0-9_$]+)\\.realpathSync\\(\\2\\)\\)\\}catch\\{return ' + esc + '\\(\\3\\)\\}\\}', 'g');
            ejsContent = ejsContent.replace(reIj, (match, fn, a, b) => {
                p2fk2Found = true;
                return `function ${fn}(${a},${b}){if(!${a})return ${fkName}(${b});return ${fkName}(${a})}`;
            });
        }
        if (p2fkFound) console.log(`      \x1b[32m✔ P2_fk (2.1.280 realpath helper, fn=${fkName}${p2fk2Found ? ' +sibling' : ''}): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P2_fk (2.1.280 realpath helper): Not found - SESSION LIST WILL BE EMPTY on mapped drives\x1b[0m`); failures.push(`${appName}: P2_fk - not found`); }
        } else console.log(`      ${YELLOW}⊘ P2 / P2_fk: stage C (not applied at stage ${STAGE})${RESET}`);

        // P3: Extension realpathSync bypass (Network drive & hash fix for backend)
        let p3Found = false;
        let p3FuncName = '';
        ejsContent = ejsContent.replace(/function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{let [a-zA-Z0-9_$]+=([a-zA-Z0-9_$]+)\.resolve\([a-zA-Z0-9_$]+\?\?"\."\),[a-zA-Z0-9_$]+;try\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.realpathSync\([a-zA-Z0-9_$]+\)\}catch\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\}return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)\}/g, (match, funcName, argName, pathName, normalizeFuncName) => {
            p3Found = true;
            p3FuncName = funcName;
            return `function ${funcName}(${argName}){return ${normalizeFuncName}(${pathName}.resolve(${argName}??"."))}`; 
        });
        if (p3Found) console.log(`      \x1b[32m✔ P3 (Backend realpath): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P3 (Backend realpath): Not found\x1b[0m`); failures.push(`${appName}: P3 - not found`); }

        // P3_cwd: Normalize global cwd so listSessions and startSession hash match identically
        let p3cwdFound = false;
        if (p3FuncName) {
            ejsContent = ejsContent.replace(/this\.cwd=([a-zA-Z0-9_$]+)(;|})/g, (match, p1, p2) => {
                p3cwdFound = true;
                return `this.cwd=typeof ${p3FuncName}==="function"?${p3FuncName}(${p1}):${p1}${p2}`;
            });
        }
        if (p3cwdFound) console.log(`      \x1b[32m✔ P3_cwd (Normalize global cwd): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P3_cwd (Normalize global cwd): Not found\x1b[0m`); failures.push(`${appName}: P3_cwd - not found`); }
        
        // P3_unc: UNC share-root workspaces (\\server\share) list NO sessions on 2.1.280.
        // The CLI writes transcripts under path.resolve(cwd), and path.resolve gives a share root a
        // trailing backslash -> projects\--server-share-  (trailing dash). 2.1.280's session lister
        // first runs the workspace through the NATIVE realpath, which drops that backslash, and then
        // only searches  projects\--server-share  -> a folder that does not exist -> empty list.
        // (Its new drive-letter fallback only covers X:\ paths, not raw UNC.) Also search the path
        // exactly as given (this.cwd, already normalised by P3_cwd) whenever it differs. Adding a
        // candidate only widens the search; results are de-duplicated by session id downstream.
        // Verified 2026-09-23 on \\192.168.1.120\3D Total: 0 -> 45 sessions (30 real + 15 shared).
        let p3unc = false;
        ejsContent = ejsContent.replace(/(let ([a-zA-Z0-9_$]+)=await [a-zA-Z0-9_$]+\(\$,[a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+\)\),[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+\)\),([a-zA-Z0-9_$]+)=[a-zA-Z0-9_$]+\(\$,\2\)),/, (match, head, resolvedVar, candVar) => {
            p3unc = true;
            return `${head},__uncAdd=typeof $==="string"&&!${candVar}.some(c=>String(c).toLowerCase()===$.toLowerCase())&&${candVar}.push($),`;
        });
        if (p3unc) console.log(`      \x1b[32m✔ P3_unc (UNC share root lists its sessions): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P3_unc (UNC share root lists its sessions): Not found - \\\\server\\share workspaces will list NO sessions\x1b[0m`); failures.push(`${appName}: P3_unc - not found`); }

        // P3_unc_root: the same trailing-backslash bug at its SOURCE. 2.1.280 resolves a workspace
        // path with one helper (native realpath -> drops a share root's trailing "\"), and three
        // things call it: the session list, the transcript reader behind readSessionForHost (so
        // every chat in a \\server\share project opened EMPTY - shared ones included), and one
        // more. P3_unc above only covered the list. Re-add the "\" to a bare share root, which is
        // exactly the form the CLI writes transcripts under (path.resolve). Deeper UNC paths and
        // drive paths are untouched. The bundle carries TWO copies of this helper (the host's own
        // and the SDK's - 7 and 3 call sites in 2.1.280), so every copy is patched (/g).
        // Verified 2026-09-24: \\192.168.1.120\3D Total, a real chat and a shared chat read 0
        // messages before, their full transcripts after.
        let p3uncRoot = 0;
        ejsContent = ejsContent.replace(/async function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)\{(try\{if\(\3!==void 0&&\3\.hoverRestOn\)\{let ([a-zA-Z0-9_$]+)=await \3\.realPath\(\2\);return ([a-zA-Z0-9_$]+)\(\5\.ok&&\5\.value\.found\?\5\.value\.path:\2\)\}return \6\(await [a-zA-Z0-9_$]+\.realpath\(\2\)\)\}catch\{return \6\(\2\)\})\}/g, (match, fn, a, b, body) => {
            p3uncRoot++;
            return `async function ${fn}(${a},${b}){let __r=await(async()=>{${body}})();try{const B=String.fromCharCode(92);if(process.platform==="win32"&&typeof __r==="string"&&__r.startsWith(B+B)&&!__r.endsWith(B)&&__r.slice(2).split(B).filter(Boolean).length===2)__r=__r+B}catch{}return __r}`;
        });
        if (p3uncRoot) console.log(`      \x1b[32m✔ P3_unc_root (share-root path keeps its trailing backslash - chats open): Applied to ${p3uncRoot} resolver copies\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P3_unc_root: Not found - chats in \\\\server\\share projects will open EMPTY\x1b[0m`); failures.push(`${appName}: P3_unc_root - not found`); }

        if (stage('C')) { // ---- stage C: P3b ----
        // P3b: async realpath bypass (hung on mapped/network drives when listing sessions).
        //
        // !!! THE CONCLUSION BELOW IS WRONG - DISPROVEN 2026-09-23 !!!
        // Shipping 2.1.280 without P2/P3b equivalents produced an EMPTY session list: the 958
        // session files were intact on disk, but the extension resolved the wrong project folder
        // and found none of them. Rolled back to 2.1.220. Do not trust "P3 + P3_cwd cover it" -
        // it was reasoning from code shape and was never tested. Before 2.1.280+ is attempted
        // again, find the real equivalent of these on that build and confirm, by restarting the
        // editor, that sessions actually list.
        //
        // Original (incorrect) reasoning retained for context:
        // NOT APPLICABLE from 2.1.280 onward, and deliberately not re-targeted. Anthropic moved
        // NFC normalisation behind a platform guard - `function i0($){return
        // process.platform==="darwin"?$.normalize("NFC"):$}` - so the `X(await Y.realpath(z))`
        // shape this matched no longer exists on Windows. The remaining bare async realpath
        // wrappers (o84/Qh4 in 2.1.280) are consumed by path-containment helpers that take an
        // `allowOutside` flag, i.e. they are sandbox boundary checks. Bypassing those would
        // weaken a security check, not fix a path bug. The RaiDrive/UNC problem this existed for
        // is handled by P3 + P3_cwd, which still apply.
        let p3bFound = false;
        ejsContent = ejsContent.replace(/async function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{try\{return ([a-zA-Z0-9_$]+)\(await ([a-zA-Z0-9_$]+)\.realpath\([a-zA-Z0-9_$]+\)\)\}catch\{return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)\}\}/g, (match, funcName, argName, cfFunc, soVar, cfFunc2) => {
            p3bFound = true;
            return `async function ${funcName}(${argName}){return ${cfFunc}(${argName})}`; 
        });
        if (p3bFound) console.log(`      \x1b[32m✔ P3b (Async session dir realpath): Applied\x1b[0m`);
        else console.log(`      \x1b[33m⊘ P3b (Async session dir realpath): n/a - NFC moved behind a darwin guard; P3+P3_cwd cover it\x1b[0m`);
        } else console.log(`      ${YELLOW}⊘ P3b: stage C (not applied at stage ${STAGE})${RESET}`);
        

        // P1_session_cmd: Register showSessionInfo in package.json commands
        try {
            const pkgObj = JSON.parse(pkgContent);
            if (pkgObj.contributes && pkgObj.contributes.commands) {
                if (!pkgObj.contributes.commands.some(c => c.command === 'claude-vscode.showSessionInfo')) {
                    pkgObj.contributes.commands.push({
                        command: 'claude-vscode.showSessionInfo',
                        title: 'Show Session Info & Size',
                        category: 'Claude'
                    });
                    pkgContent = JSON.stringify(pkgObj, null, 2);
                    fs.writeFileSync(pkg, pkgContent);
                    console.log(`      \x1b[32m✔ P1_session_cmd (Session Info command contributes): Applied\x1b[0m`);
                }
            }
        } catch (e) {}

        if (stage('B')) { // ---- stage B: P8 ----
        // P8: Advanced Multi-Window Usage status bar HTTP server & Session Size Monitor
        const usageIIFE = '(()=>{const _http=require("http");const _https=require("https");const _fs=require("fs");const _os=require("os");const _path=require("path");const _credsPath=_path.join(_os.homedir(),".claude",".credentials.json");const _markerPath=_path.join(_os.homedir(),".claude",".active_account");const _cfgPath=_path.join(_os.homedir(),".claude.json");function _readJsonSafe(p){try{return JSON.parse(_fs.readFileSync(p,"utf8"));}catch{return null;}}function _getActiveOrgId(){try{const creds=JSON.parse(_fs.readFileSync(_credsPath,"utf8"));return creds.organizationUuid;}catch{return undefined;}}function _getActiveAccountNum(){try{const n=_fs.readFileSync(_markerPath,"utf8").trim();if(n==="1"||n==="2")return n;}catch{}return null;}function _liveAccountUuid(){try{const c=_readJsonSafe(_cfgPath);return c&&c.oauthAccount&&c.oauthAccount.accountUuid||null;}catch{return null;}}function _slotAccountUuid(n){try{const b=_readJsonSafe(_path.join(_os.homedir(),".claude",".credentials_account"+n+".json"));return b&&b.oauthAccount&&b.oauthAccount.accountUuid||null;}catch{return null;}}function _syncLiveTokenToActiveSlot(){try{const live=_readJsonSafe(_credsPath);if(!live||!live.claudeAiOauth)return;const liveUuid=_liveAccountUuid();if(!liveUuid)return;for(const n of ["1","2"]){if(_slotAccountUuid(n)!==liveUuid)continue;const p=_path.join(_os.homedir(),".claude",".credentials_account"+n+".json");const bk=_readJsonSafe(p)||{};const cur=bk.claudeAiOauth||{};if(cur.accessToken!==live.claudeAiOauth.accessToken||cur.refreshToken!==live.claudeAiOauth.refreshToken){bk.claudeAiOauth=live.claudeAiOauth;if(live.organizationUuid)bk.organizationUuid=live.organizationUuid;_fs.writeFileSync(p,JSON.stringify(bk,null,2),"utf8");}return;}}catch{}}function _reconcileActiveSlot(){try{const live=_liveAccountUuid();if(!live)return;const u1=_slotAccountUuid("1"),u2=_slotAccountUuid("2");if(u1&&u2&&u1===u2)return;let real=null;if(u1&&u1===live)real="1";else if(u2&&u2===live)real="2";if(!real)return;if(_getActiveAccountNum()!==real){_fs.writeFileSync(_markerPath,real,"utf8");_lastKnownSlot=real;_usageFreshForSlot=null;}}catch{}}function _getUsageFile(){const accNum=_getActiveAccountNum();if(accNum==="1")return _path.join(_os.homedir(),".claude","usage_account1.json");if(accNum==="2")return _path.join(_os.homedir(),".claude","usage_account2.json");return _path.join(_os.homedir(),".claude","usage.json");}const _wu=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,9);_wu.command="claude-vscode.openUsage";_wu.tooltip="Claude usage";_wu.text="$(graph)Claude usage";_wu.show();e.subscriptions.push(_wu);e.subscriptions.push(Se.commands.registerCommand("claude-vscode.openUsage",()=>{ Se.env.openExternal(Se.Uri.parse("https://claude.ai/settings/usage"));}));const _wa=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,10);_wa.command="claude-vscode.swapAccount";_wa.tooltip="Swap Claude Account";_wa.text="$(account)Account Switcher";_wa.show();e.subscriptions.push(_wa);const _acc1Path=_path.join(_os.homedir(),".claude",".credentials_account1.json");const _acc2Path=_path.join(_os.homedir(),".claude",".credentials_account2.json");function _getAccountInfo(){ const accNum=_getActiveAccountNum(); if(accNum==="1")return{currentAcc:"Account 1",otherAccPath:_acc2Path,otherAccNum:"2"}; if(accNum==="2")return{currentAcc:"Account 2",otherAccPath:_acc1Path,otherAccNum:"1"}; return{currentAcc:"Unknown",otherAccPath:null,otherAccNum:null};}function _updateAccountSwitcher(){ const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo(); function _cd(ts){if(!ts)return "";const d=ts-Date.now();if(d<=0)return "(Expired!)";const days=Math.floor(d/86400000);if(days>0)return "("+days+"d)";return "("+Math.floor(d/3600000)+"h)";} const live=_readJsonSafe(_credsPath); const countdown=live&&live.claudeAiOauth?_cd(live.claudeAiOauth.refreshTokenExpiresAt):""; const cfg=_readJsonSafe(_cfgPath); const curName=cfg&&cfg.oauthAccount&&cfg.oauthAccount.displayName?cfg.oauthAccount.displayName:""; let label=currentAcc==="Unknown"?"Account ?":currentAcc; if(curName)label=label+": "+curName; _wa.text="$(account) "+label+(countdown?" "+countdown:""); const oth=otherAccPath?_readJsonSafe(otherAccPath):null; const othName=oth&&oth.oauthAccount&&oth.oauthAccount.displayName?" ("+oth.oauthAccount.displayName+")":""; const othCd=oth&&oth.claudeAiOauth?_cd(oth.claudeAiOauth.refreshTokenExpiresAt):""; _wa.tooltip=otherAccNum?("Signed in as "+label+" "+countdown+" - click to switch to Account "+otherAccNum+othName+" "+othCd):"Swap Claude Account";}function _isTokenExpired(oauthObj){ if(!oauthObj)return true; if(oauthObj.refreshTokenExpiresAt&&oauthObj.refreshTokenExpiresAt<Date.now())return true; if(!oauthObj.refreshToken&&oauthObj.expiresAt&&oauthObj.expiresAt<Date.now())return true; return false;}function _swapAccounts(silent=false){ const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo(); if(!otherAccPath||!_fs.existsSync(otherAccPath)){ if(!silent)Se.window.showErrorMessage("Cannot swap:Backup for account "+otherAccNum+" not found at "+otherAccPath); return; } try{ const currentCreds=JSON.parse(_fs.readFileSync(_credsPath,"utf8")); const currentCfg=_readJsonSafe(_cfgPath); const currentBackupPath=currentAcc==="Account 1"?_acc1Path:_acc2Path; if(currentAcc!=="Unknown"){ const bk={claudeAiOauth:currentCreds.claudeAiOauth}; if(currentCreds.organizationUuid)bk.organizationUuid=currentCreds.organizationUuid; if(currentCfg&&currentCfg.oauthAccount)bk.oauthAccount=currentCfg.oauthAccount; _fs.writeFileSync(currentBackupPath,JSON.stringify(bk,null,2),"utf8"); } const otherCreds=_readJsonSafe(otherAccPath); if(!otherCreds||!otherCreds.claudeAiOauth){ if(!silent)Se.window.showErrorMessage("Swap aborted: backup for account "+otherAccNum+" has no claudeAiOauth token."); return; } const targetExpired=_isTokenExpired(otherCreds.claudeAiOauth); currentCreds.claudeAiOauth=otherCreds.claudeAiOauth; if(targetExpired){ delete currentCreds.organizationUuid; }else{ if(otherCreds.organizationUuid)currentCreds.organizationUuid=otherCreds.organizationUuid; else delete currentCreds.organizationUuid; } _fs.writeFileSync(_credsPath,JSON.stringify(currentCreds,null,2),"utf8"); if(currentCfg){ try{_fs.writeFileSync(_cfgPath+".bak-swap-"+Date.now(),JSON.stringify(currentCfg,null,2),"utf8");}catch{} if(targetExpired){ delete currentCfg.oauthAccount; }else{ if(otherCreds.oauthAccount)currentCfg.oauthAccount=otherCreds.oauthAccount; else delete currentCfg.oauthAccount; } _fs.writeFileSync(_cfgPath,JSON.stringify(currentCfg,null,2),"utf8"); } if(!silent&&targetExpired){ Se.window.showWarningMessage("Account "+otherAccNum+" token has expired. Claude Code will prompt you to re-login. All identity data will be captured fresh."); }else if(!silent&&(!otherCreds.organizationUuid||!otherCreds.oauthAccount)){ Se.window.showWarningMessage("Account "+otherAccNum+" backup has no cached org identity. Claude will re-derive it from the token on load; swap away and back once to capture it."); } _fs.writeFileSync(_markerPath,otherAccNum,"utf8"); if(silent)return true; Se.commands.executeCommand("workbench.action.reloadWindow"); }catch(err){ if(!silent)Se.window.showErrorMessage("Swap failed:"+err.message); }}e.subscriptions.push(Se.commands.registerCommand("claude-vscode.swapAccount",()=>{ _swapAccounts(false);}));const _ws=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,8);_ws.command="claude-vscode.showSessionInfo";_ws.tooltip="Claude Session & JSONL File Size";_ws.text="$(comment-discussion) Session (0 KB)";_ws.show();e.subscriptions.push(_ws);let _curSessionId=null;let _curSessionTitle=null;let _curSessionFile=null;let _curSessionBytes=0;function _fmtSize(b){if(!b||b<=0)return "0 KB";if(b<1024)return b+" B";if(b<1024*1024)return(b/1024).toFixed(1)+" KB";return(b/(1024*1024)).toFixed(2)+" MB";}function _findJsonl(sid){ if(!sid)return null; const base=process.env.CLAUDE_CONFIG_DIR||_path.join(_os.homedir(),".claude"); const pdir=_path.join(base,"projects"); if(!_fs.existsSync(pdir))return null; try{const wf=Se.workspace.workspaceFolders;if(wf&&wf.length>0){const sanitized=String(wf[0].uri.fsPath).replace(/[^a-zA-Z0-9]/g,"-");const direct=_path.join(pdir,sanitized,sid+".jsonl");if(_fs.existsSync(direct))return direct;}}catch{} try{const dirs=_fs.readdirSync(pdir);for(const d of dirs){const cand=_path.join(pdir,d,sid+".jsonl");if(_fs.existsSync(cand))return cand;}}catch{} return null;}function _findLatestJsonl(){ const base=process.env.CLAUDE_CONFIG_DIR||_path.join(_os.homedir(),".claude"); const pdir=_path.join(base,"projects"); if(!_fs.existsSync(pdir))return null; let latest=null;let latestMtime=0; try{ const wf=Se.workspace.workspaceFolders; const targetDirs=[]; if(wf&&wf.length>0){const sanitized=String(wf[0].uri.fsPath).replace(/[^a-zA-Z0-9]/g,"-");targetDirs.push(_path.join(pdir,sanitized));} for(const d of _fs.readdirSync(pdir)){const full=_path.join(pdir,d);if(!targetDirs.includes(full))targetDirs.push(full);} for(const td of targetDirs){ if(!_fs.existsSync(td)||!_fs.statSync(td).isDirectory())continue; const files=_fs.readdirSync(td).filter(f=>f.endsWith(".jsonl")); for(const f of files){try{const fp=_path.join(td,f);const st=_fs.statSync(fp);if(st.mtimeMs>latestMtime){latestMtime=st.mtimeMs;latest={path:fp,sessionId:f.replace(/\\\\.jsonl$/,""),size:st.size,mtime:st.mtimeMs};}}catch{}} if(latest&&targetDirs.indexOf(td)===0)break; } }catch{} return latest;}function _updateSessionStatusBar(){ let fpath=_curSessionFile; if(!fpath&&_curSessionId){fpath=_findJsonl(_curSessionId);_curSessionFile=fpath;} if(!fpath&&!_curSessionId){const lat=_findLatestJsonl();if(lat){_curSessionId=lat.sessionId;fpath=lat.path;_curSessionFile=fpath;_curSessionBytes=lat.size;}} if(fpath&&_fs.existsSync(fpath)){try{const st=_fs.statSync(fpath);_curSessionBytes=st.size;}catch{}}else{_curSessionBytes=0;} const szStr=_fmtSize(_curSessionBytes); let title=_curSessionTitle; if(!title){title=_curSessionId?("Session "+_curSessionId.slice(0,8)):"New Session";} let displayTitle=title; if(displayTitle.length>22){displayTitle=displayTitle.slice(0,20)+"\\u2026";} const isHeavy=_curSessionBytes>=5*1024*1024; const isModerate=_curSessionBytes>=1*1024*1024; const icon=isHeavy?"$(warning)":(isModerate?"$(comment-discussion)":"$(comment-discussion)"); _ws.text=icon+" "+displayTitle+" ("+szStr+(isHeavy?" - Large!":"")+")"; let healthNote="\\\\u2705 **Context Health**: Healthy (< 1 MB). Minimal recurring token overhead."; if(isHeavy){healthNote="\\\\U0001F6A8 **Context Health**: Heavy Session (> 5 MB). Every message re-reads massive history. Run \\\\`/compact\\\\` or \\\\`/clear\\\\` to save quota!";} else if(isModerate){healthNote="\\\\u26A0\\\\uFE0F **Context Health**: Moderate Session (1\\u20135 MB, ~100k-250k tokens). Consider running \\\\`/compact\\\\` soon.";} const tip=new Se.MarkdownString(); tip.isTrusted=true;tip.supportThemeIcons=true; tip.appendMarkdown("### \\\\U0001F4AC Claude Code Active Session\\\\n\\\\n"); tip.appendMarkdown("**Title**: "+title+"\\\\n\\\\n"); tip.appendMarkdown("**Session ID**: \\\\`"+(_curSessionId||"None")+"\\\\`\\\\n\\\\n"); tip.appendMarkdown("**JSONL File Size**: "+szStr+" ("+_curSessionBytes.toLocaleString()+" bytes)\\\\n\\\\n"); if(fpath){tip.appendMarkdown("**File Path**: \\\\`"+fpath+"\\\\`\\\\n\\\\n");} tip.appendMarkdown(healthNote+"\\\\n\\\\n"); tip.appendMarkdown("---\\\\n*Click to open JSONL file or copy Session ID*"); _ws.tooltip=tip;}globalThis.__claudeActiveSessionUpdate=function(sid,title){ if(sid)_curSessionId=sid; if(title&&title!==_curSessionTitle)_curSessionTitle=title; _curSessionFile=null; _updateSessionStatusBar();};e.subscriptions.push(Se.commands.registerCommand("claude-vscode.showSessionInfo",async()=>{ const szStr=_fmtSize(_curSessionBytes); const items=[ {label:"$(file) Open Session JSONL File",description:szStr,detail:_curSessionFile||"No JSONL file found",action:"open_file"}, {label:"$(clippy) Copy Session ID",detail:_curSessionId||"No active session ID",action:"copy_id"}, {label:"$(clippy) Copy JSONL File Path",detail:_curSessionFile||"No JSONL file found",action:"copy_path"}, {label:"$(sparkle) Compact Session (/compact)",description:"Reduce context size while keeping summary",detail:"Type /compact in your Claude chat to compress large session context",action:"compact_info"} ]; const chosen=await Se.window.showQuickPick(items,{placeHolder:"Claude Session: "+(_curSessionTitle||_curSessionId||"Active Session")+" ("+szStr+")"}); if(!chosen)return; if(chosen.action==="open_file"&&_curSessionFile&&_fs.existsSync(_curSessionFile)){ try{const doc=await Se.workspace.openTextDocument(Se.Uri.file(_curSessionFile));await Se.window.showTextDocument(doc);}catch(err){Se.window.showErrorMessage("Could not open JSONL file: "+err.message);} }else if(chosen.action==="copy_id"&&_curSessionId){ await Se.env.clipboard.writeText(_curSessionId);Se.window.showInformationMessage("Copied Session ID to clipboard!"); }else if(chosen.action==="copy_path"&&_curSessionFile){ await Se.env.clipboard.writeText(_curSessionFile);Se.window.showInformationMessage("Copied JSONL path to clipboard!"); }else if(chosen.action==="compact_info"){ Se.window.showInformationMessage("To compact this session, type \'/compact\' in your Claude Code chat. This compresses the conversation history into a ~3-5 KB summary."); }}));function _fmtU(d){ try{ const p=Math.round(d.five_hour&&d.five_hour.utilization||0); const wk=Math.round(d.seven_day&&d.seven_day.utilization||0); let r=""; if(d.five_hour&&d.five_hour.resets_at){ const ms=new Date(d.five_hour.resets_at)-Date.now(); if(ms>0){const h=Math.floor(ms/3600000);const m=Math.floor((ms%3600000)/60000);if(h>0){r=" resets in "+h+" hr "+m+" min";}else{r=" resets in "+m+" min";}} } const blocks=Math.round(p/10); const full="\\u2588".repeat(Math.min(10,blocks)); const empty="\\u2591".repeat(Math.max(0,10-blocks)); return{text:full+empty+" "+p+"%"+r+" \\u2014 Weekly "+wk+"%",util:p}; }catch{return{text:"$(graph)Claude usage(err)",util:0};}}const _autoStatePath=_path.join(_os.homedir(),".claude",".autoswap_state.json");const _AUTO_THRESHOLD=95;const _AUTO_COOLDOWN_MS=1800000;let _usageFreshForSlot=null;function _winUtil(w){try{if(!w)return 0;if(w.resets_at&&new Date(w.resets_at).getTime()<=Date.now())return 0;return Math.round(w.utilization||0);}catch{return 0;}}function _peakUtil(d){try{return Math.max(_winUtil(d&&d.five_hour),_winUtil(d&&d.seven_day));}catch{return 0;}}function _otherHasHeadroom(n){try{const f=_path.join(_os.homedir(),".claude","usage_account"+n+".json");if(!_fs.existsSync(f))return true;return _peakUtil(_readJsonSafe(f))<_AUTO_THRESHOLD;}catch{return true;}}function _autoSwapAllowed(){try{const st=_readJsonSafe(_autoStatePath);if(st&&st.lastSwapAt&&(Date.now()-st.lastSwapAt)<_AUTO_COOLDOWN_MS)return false;}catch{}return true;}function _noteAutoSwap(){try{_fs.writeFileSync(_autoStatePath,JSON.stringify({lastSwapAt:Date.now()}),"utf8");}catch{}}let _autoReloadTimer=null;let _autoReloadFired=false;function _triggerAutoSwap(){ const info=_getAccountInfo(); if(!info.otherAccNum)return; if(!_autoSwapAllowed()){_autoReloadFired=true;return;} if(!_otherHasHeadroom(info.otherAccNum)){_autoReloadFired=true;Se.window.showWarningMessage("Claude quota reached, but Account "+info.otherAccNum+" is also at its limit - staying put.");return;} const swapped=_swapAccounts(true); if(swapped){ _noteAutoSwap();_autoReloadFired=true; _autoReloadTimer=setTimeout(()=>{Se.commands.executeCommand("workbench.action.reloadWindow");},5000); Se.window.showWarningMessage("Claude quota reached - swapped to Account "+info.otherAccNum+". Reloading in 5s...","Cancel Reload","Reload Now").then(sel=>{ if(sel==="Cancel Reload"){try{clearTimeout(_autoReloadTimer);}catch{}_swapAccounts(true);_updateAccountSwitcher();} else if(sel==="Reload Now"){try{clearTimeout(_autoReloadTimer);}catch{}Se.commands.executeCommand("workbench.action.reloadWindow");} }); }}function _fetchUsageNow(){ try{ const c=_readJsonSafe(_credsPath); if(!c||!c.claudeAiOauth||!c.claudeAiOauth.accessToken)return; const slot=_getActiveAccountNum(); const target=_getUsageFile(); const token=c.claudeAiOauth.accessToken; const req=_https.request("https://api.anthropic.com/api/oauth/usage",{method:"GET",headers:{"Authorization":"Bearer "+token,"anthropic-beta":"oauth-2025-04-20","Content-Type":"application/json"},timeout:15000},(r)=>{ let b="";r.on("data",(d)=>{b+=d;}); r.on("end",()=>{try{if(r.statusCode!==200)return;const u=JSON.parse(b);if(!u||!u.five_hour)return;if(_getActiveAccountNum()!==slot)return;_fs.writeFileSync(target,JSON.stringify(u),"utf8");_usageFreshForSlot=slot;_updateFromCacheRefactored();}catch{}}); }); req.on("error",()=>{});req.on("timeout",()=>{try{req.destroy();}catch{}});req.end(); const preq=_https.request("https://api.anthropic.com/api/oauth/profile",{method:"GET",headers:{"Authorization":"Bearer "+token,"anthropic-beta":"oauth-2025-04-20","Content-Type":"application/json"},timeout:15000},(pr)=>{ let pb="";pr.on("data",(d)=>{pb+=d;}); pr.on("end",()=>{ try{ if(pr.statusCode!==200)return; const pj=JSON.parse(pb); if(!pj||!pj.account||!pj.account.uuid)return; if(_getActiveAccountNum()!==slot)return; const curCfg=_readJsonSafe(_cfgPath)||{}; const liveOrg=pj.organization?.uuid||c.organizationUuid; const liveName=pj.account.display_name||pj.account.full_name||("Account "+slot); const synOauth={ accountUuid:pj.account.uuid, emailAddress:pj.account.email, organizationUuid:liveOrg, hasExtraUsageEnabled:pj.organization?.has_extra_usage_enabled||false, billingType:pj.organization?.billing_type||"stripe_subscription", accountCreatedAt:pj.account.created_at, subscriptionCreatedAt:pj.organization?.subscription_created_at, ccOnboardingFlags:pj.organization?.cc_onboarding_flags||{}, claudeCodeTrialEndsAt:pj.organization?.claude_code_trial_ends_at||null, claudeCodeTrialDurationDays:pj.organization?.claude_code_trial_duration_days||null, seatTier:pj.organization?.seat_tier||null, displayName:liveName, profileFetchedAt:Date.now(), organizationRole:"user", workspaceRole:null, organizationName:pj.organization?.name||"Organization", organizationType:pj.organization?.organization_type||"claude_pro", organizationRateLimitTier:pj.organization?.rate_limit_tier||"default_claude_ai", userRateLimitTier:pj.organization?.rate_limit_tier||"default_claude_ai" }; if(!curCfg.oauthAccount||curCfg.oauthAccount.accountUuid!==synOauth.accountUuid||curCfg.oauthAccount.displayName!==synOauth.displayName||curCfg.oauthAccount.organizationUuid!==liveOrg){ curCfg.oauthAccount=synOauth; _fs.writeFileSync(_cfgPath,JSON.stringify(curCfg,null,2),"utf8"); } if(liveOrg){ const freshCreds=_readJsonSafe(_credsPath); if(freshCreds&&freshCreds.organizationUuid!==liveOrg){ freshCreds.organizationUuid=liveOrg; _fs.writeFileSync(_credsPath,JSON.stringify(freshCreds,null,2),"utf8"); } } const curBkPath=slot==="1"?_acc1Path:_acc2Path; if(_fs.existsSync(curBkPath)){ const bk=_readJsonSafe(curBkPath)||{}; if(!bk.oauthAccount||bk.oauthAccount.accountUuid!==synOauth.accountUuid||bk.oauthAccount.displayName!==synOauth.displayName||bk.organizationUuid!==liveOrg){ bk.oauthAccount=synOauth; if(liveOrg)bk.organizationUuid=liveOrg; _fs.writeFileSync(curBkPath,JSON.stringify(bk,null,2),"utf8"); } } _updateAccountSwitcher(); }catch{} }); }); preq.on("error",()=>{});preq.on("timeout",()=>{try{preq.destroy();}catch{}});preq.end(); }catch{}}function _updateFromCacheRefactored(){ _updateAccountSwitcher();_updateSessionStatusBar(); const usageFile=_getUsageFile(); try{if(_fs.existsSync(usageFile)){const d=JSON.parse(_fs.readFileSync(usageFile,"utf8"));const res=_fmtU(d);if(res&&res.text){_wu.text="$(graph)Session "+res.text;}if(_usageFreshForSlot&&_usageFreshForSlot===_getActiveAccountNum()&&_peakUtil(d)>=_AUTO_THRESHOLD&&!_autoReloadFired){_triggerAutoSwap();}}}catch{}}_updateFromCacheRefactored();_fetchUsageNow();setInterval(_fetchUsageNow,120000);setInterval(_updateSessionStatusBar,3000);let _lastKnownSlot=_getActiveAccountNum();try{ _fs.watchFile(_markerPath,{interval:2000},()=>{ const newSlot=_getActiveAccountNum(); if(newSlot!==_lastKnownSlot){ _lastKnownSlot=newSlot; _usageFreshForSlot=null; _autoReloadFired=false; setTimeout(_fetchUsageNow,3000); _updateFromCacheRefactored(); } });}catch{}try{ _fs.watchFile(_credsPath,{interval:2000},()=>{ _usageFreshForSlot=null; _autoReloadFired=false; _reconcileActiveSlot(); _syncLiveTokenToActiveSlot(); setTimeout(_fetchUsageNow,1500); _updateFromCacheRefactored(); });}catch{}let _currentWatched=_getUsageFile();try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}setInterval(()=>{ const newWatched=_getUsageFile(); if(newWatched!==_currentWatched){try{_fs.unwatchFile(_currentWatched);}catch{}_currentWatched=newWatched;try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}} _updateFromCacheRefactored();},5000);const _srv=_http.createServer((req,res)=>{ try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]req:${req.method}${req.url}\\n`,"utf8");}catch{} if(req.method==="POST"&&req.url==="/usage"){ let b="";req.on("data",c=>{b+=c;}); req.on("end",()=>{ try{const parsed=JSON.parse(b);try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]POST parsed:usage=${!!parsed.usage}\\n`,"utf8");}catch{}if(parsed.usage){_fetchUsageNow();}}catch{} res.writeHead(200);res.end("ok"); }); }else{res.writeHead(404);res.end();}});_srv.on("error",(e)=>{});try{_srv.listen(54321,"127.0.0.1");}catch{}e.subscriptions.push({dispose:()=>{try{_srv.close();}catch{}try{_fs.unwatchFile(_currentWatched);}catch{}try{_fs.unwatchFile(_markerPath);}catch{}}});try{ const{spawn}=require("child_process"); const _syncPs=_path.join(_os.homedir(),".claude","projects","sync-shared.ps1"); if(_fs.existsSync(_syncPs)){ const _sc=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",_syncPs],{stdio:"ignore",windowsHide:true}); _sc.on("error",()=>{});_sc.unref(); }}catch(e){}})();';
        
        // P8 must rewrite TWO minified identifiers, not one.
        //
        // `Se.` is the vscode namespace - that was always substituted. But the IIFE also hardcodes
        // `e` as the ExtensionContext (`e.subscriptions.push(...)`), and that parameter is renamed
        // every build. It happened to be `e` in 2.1.220 so this worked by luck; in 2.1.280 it is
        // `$`, so the injected code threw a ReferenceError inside activate() and took the WHOLE
        // extension down - no status bar, no account switcher, no sessions, nothing. That is the
        // 2026-09-23 outage. Capture the context var from the same statement and substitute it.
        let p8ctx = null;
        ejsContent = applyRegex(ejsContent, /(let\s+[a-zA-Z0-9_$]+\s*=\s*([a-zA-Z0-9_$]+)\.window\.createStatusBarItem\([a-zA-Z0-9_$]+\.StatusBarAlignment\.Right\);.*?)(if\(([a-zA-Z0-9_$]+)\.subscriptions\.push\([a-zA-Z0-9_$]+\.commands\.registerCommand\("claude-vscode\.sidebar\.open"[,)]+)/, (match, p1, vscodeVar, p2, ctxVar) => {
            p8ctx = ctxVar;
            const body = usageIIFE
                .replace(/Se\./g, `${vscodeVar}.`)
                .replace(/\be\.subscriptions\b/g, `${ctxVar}.subscriptions`);
            // The IIFE runs synchronously inside activate(). Unguarded, ANY throw in it aborts
            // activation and the editor marks the whole extension failed - status bar, account
            // switcher, session list and the Claude agent itself all die together. Guarded, the
            // worst case is "enhancer features missing" and the reason is logged as
            // "[enhancer] P8 failed:" in the window's renderer.log. Never inject it bare again.
            const guarded = `try{${body.replace(/;\s*$/, '')}}catch(__e){try{console.error("[enhancer] P8 failed:",__e)}catch{}}`;
            return `${p1}${guarded}${p2}`;
        }, 'P8 (Status bar server & Session size monitor)');
        if (p8ctx) console.log(`      \x1b[36mℹ P8 bound to ExtensionContext '${p8ctx}' (guarded)\x1b[0m`);
        } else console.log(`      ${YELLOW}⊘ P8: stage B (not applied at stage ${STAGE})${RESET}`);

        if (stage('C')) { // ---- stage C: P13, P13_panel, P12* (incl. P12_follow) ----
        // The P13 hooks call into globalThis.__claudeActiveSessionUpdate, which P8 installs. They
        // run inside the extension's own session-state methods, so a throw from the hook would
        // break session state/panel switching. Wrap as an expression (P13_panel lands inside an
        // if-condition, where a try statement cannot go).
        const sessionHook = (sid, title) => `(()=>{try{globalThis.__claudeActiveSessionUpdate&&globalThis.__claudeActiveSessionUpdate(${sid},${title})}catch(__e){try{console.error("[enhancer] P13 hook failed:",__e)}catch{}}})()`;

        // P13: Hook active session state updates to live status bar.
        // 2.1.280 reshaped this: updateSessionState now takes 4 args, the body is wrapped in a
        // guard, and the stored value is nested as {info:{sessionId,state,title},author}. The
        // separator before broadcastSessionStates() also changed from ',' to ';'. Matched
        // loosely (lazy gap + optional guard) so a further reshuffle does not silently break it.
        ejsContent = applyRegex(ejsContent, /(updateSessionState\([^)]*\)\{[\s\S]{0,140}?this\.sessionStates\.set\(([a-zA-Z0-9_$]+),\{info:\{sessionId:[a-zA-Z0-9_$]+,state:[a-zA-Z0-9_$]+,title:([a-zA-Z0-9_$]+)\},author:[a-zA-Z0-9_$]+\}\));(this\.broadcastSessionStates\(\)\})/, (match, p1, sidVar, titleVar, p2) => {
            return `${p1};${sessionHook(sidVar, titleVar)};${p2}`;
        }, 'P13 (Session state hook)');

        // P13_panel: 2.1.280 moved the assignment inside an if-condition comma expression
        // (`if(this.activeSessionId=Q,!(...))`) and gained an unread-clearing branch, so there is
        // no longer a trailing `broadcastSessionStates();return}` to anchor on. Inject into the
        // comma expression right after the assignment - evaluation order is left to right.
        // Title is now under .info.title, not .title.
        ejsContent = applyRegex(ejsContent, /(setActivePanel\([^)]*\)\{for\(let\[([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\]of this\.sessionPanels\)if\(\3===[a-zA-Z0-9_$]+\)\{if\(this\.activeSessionId=\2),/, (match, p1, sidVar, panelVar) => {
            // arrow IIFE keeps `this` bound to the session manager
            return `${p1},${sessionHook(sidVar, `this.sessionStates.get(${sidVar})?.info?.title`)},`;
        }, 'P13_panel (Active panel hook)');
        
        // P11 (session grouping by [GroupName] title prefix) - RETIRED 2026-09-23 for 2.1.280.
        // 2.1.280 ships native session groups ("Add Session Tab to Group" / "New group...", persisted
        // per project and rendered in the session list), which supersede the prefix hack. The old
        // target (an inline .map() render) no longer exists either. See git history for the code.

        // P12 (ext): isShared symlink check
        //
        // Locate the "cwd -> ~/.claude/projects/<encoded>" helper in THIS build rather
        // than hardcoding its minified name. That name is NOT stable across releases:
        // it was EWe in 2.1.206, but in 2.1.220 EWe is DISABLE_TELEMETRY (a bool), so
        // EWe(cwd) threw, the catch swallowed it, and isShared was silently false
        // forever - shared sessions never rendered italic and nothing reported an error.
        //
        // Shape we are looking for:  function N(e){return X.join(R(),ENC(e))}
        //                     where  function R(){return Y.join(Z(),"projects")}
        const projDirFns = [];
        const projFnRe = /function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{return ([a-zA-Z0-9_$]+)\.join\(([a-zA-Z0-9_$]+)\(\),([a-zA-Z0-9_$]+)\(\2\)\)\}/g;
        let projMatch;
        while ((projMatch = projFnRe.exec(ejsContent)) !== null) {
            const rootFn = projMatch[4].replace(/\$/g, '\\$');
            const rootRe = new RegExp(`function ${rootFn}\\(\\)\\{return [a-zA-Z0-9_$]+\\.join\\([a-zA-Z0-9_$]+\\(\\),"projects"\\)\\}`);
            if (rootRe.test(ejsContent) && !projDirFns.includes(projMatch[1])) projDirFns.push(projMatch[1]);
        }
        if (projDirFns.length) console.log(`      ${CYAN}ℹ project-dir helper(s) detected: ${projDirFns.join(', ')}${RESET}`);
        else console.log(`      ${YELLOW}⚠ no project-dir helper found - isShared will use the inline fallback${RESET}`);

        let p12ExtFound = false;
        ejsContent = ejsContent.replace(/isCurrentWorkspace:([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\.cwd,this\.cwd\),\.\.\.([a-zA-Z0-9_$]+)\}\}\)/g, (match, rQe, oVar, sVar) => {
            p12ExtFound = true;
            // try each detected helper, guarded by typeof so an out-of-scope name is
            // simply skipped instead of throwing; fall back to computing the path
            // directly if the bundle ever stops exposing one.
            const chain = projDirFns
                .map(fn => `try{if(!_sd&&typeof ${fn}==="function")_sd=${fn}(${oVar}.cwd);}catch{}`)
                .join('');
            const fallback = `if(!_sd){var _sr=process.env.CLAUDE_CONFIG_DIR||_sp.join(require("os").homedir(),".claude");_sd=_sp.join(_sr,"projects",String(${oVar}.cwd).replace(/[^a-zA-Z0-9]/g,"-"));}`;
            const expr = `(()=>{try{var _sf=require("fs"),_sp=require("path"),_sd=null;${chain}${fallback}return _sf.lstatSync(_sp.join(_sd,${oVar}.sessionId+".jsonl")).isSymbolicLink()}catch{return!1}})()`;
            return `isCurrentWorkspace:${rQe}(${oVar}.cwd,this.cwd),isShared:${expr},...${sVar}}})`;
        });
        if (p12ExtFound) console.log(`      \x1b[32m✔ P12_ext (isShared field detection): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P12_ext (isShared field detection): Not found\x1b[0m`); failures.push(`${appName}: P12_ext - not found`); }

        // P12_follow: let the session list read SHARED (symlinked) sessions again.
        //
        // 2.1.280 added symlink hardening to the session-file reader: on POSIX it opens with
        // O_NOFOLLOW, and on Windows (no O_NOFOLLOW) it falls back to
        //     if(!(await fs.lstat(file)).isFile())return null
        // lstat does not follow links, so every symlinked .jsonl reads as "not a file" and is
        // silently dropped. Shared chats live in projects\General\ and are symlinked into every
        // project by sync-shared.ps1, so ALL of them vanished from every project's list (verified
        // 2026-09-23: 19 candidates in GetHome, all 15 symlinks dropped at this check).
        // Relax it narrowly: a symlink is accepted only if it resolves to a regular file INSIDE the
        // projects root. Anything else is still refused, so the hardening stays in force.
        let p12Follow = false;
        ejsContent = ejsContent.replace(/if\(([a-zA-Z0-9_$]+)===([a-zA-Z0-9_$]+)\.constants\.O_RDONLY\)\{if\(!\(await ([a-zA-Z0-9_$]+)\.lstat\(([a-zA-Z0-9_$]+)\)\)\.isFile\(\)\)return null\}/g, (match, flagVar, fsConst, fsp, file) => {
            p12Follow = true;
            return `if(${flagVar}===${fsConst}.constants.O_RDONLY){let _l=await ${fsp}.lstat(${file});if(!_l.isFile()){if(!_l.isSymbolicLink())return null;let _p=require("path"),_root=_p.join(process.env.CLAUDE_CONFIG_DIR||_p.join(require("os").homedir(),".claude"),"projects");try{_root=await ${fsp}.realpath(_root)}catch{}let _t=await ${fsp}.realpath(${file});if(!_t.toLowerCase().startsWith(_root.toLowerCase()+_p.sep)||!(await ${fsp}.stat(_t)).isFile())return null}}`;
        });
        if (p12Follow) console.log(`      \x1b[32m✔ P12_follow (list symlinked shared sessions): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P12_follow (list symlinked shared sessions): Not found - SHARED CHATS WILL NOT LIST\x1b[0m`); failures.push(`${appName}: P12_follow - not found`); }

        // P14: never AUTO-archive a shared chat. 2.1.280 auto-archives chats idle for N days, and
        // the archive list is global while groups are per project - so a shared chat grouped in one
        // project was archived by another project's sweep, which hid it everywhere and dropped it
        // out of its group. Manual archive still works. Relies on isShared from P12_ext.
        let p14 = false;
        ejsContent = ejsContent.replace(/(isInUse:([a-zA-Z0-9_$]+),unarchivedAt:[a-zA-Z0-9_$]+\}=[a-zA-Z0-9_$]+;[\s\S]{0,400}?)if\(\2\(([a-zA-Z0-9_$]+)\)\)continue;/, (match, head, inUse, s) => {
            p14 = true;
            return `${head}if(${inUse}(${s})||${s}&&${s}.isShared===true)continue;`;
        });
        if (p14) console.log(`      \x1b[32m✔ P14 (never auto-archive shared chats): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P14 (never auto-archive shared chats): Not found\x1b[0m`); failures.push(`${appName}: P14 - not found`); }

        // P15: "[Folder] title" -> native session group "Folder", prefix stripped (like [s] sharing).
        // Runs when a project's session list loads, BEFORE the auto-archive sweep, so grouped chats
        // are exempt from it. Uses only the extension's named methods (renameSession,
        // updateSessionGroups, unarchiveSessions, settings.*) - never minified helpers, which are
        // renamed every build. Groups are per project but titles are global, so the prefix is
        // recorded in ~/.claude/folder-groups.json first; every project then applies it once
        // (after that the user's own group changes win). Never throws into the list load.
        async function folderGroupsHook(self, list, genAtBuild) {
            const prev = globalThis.__folderGroupsLock || Promise.resolve();
            let release;
            globalThis.__folderGroupsLock = new Promise(r => { release = r; });
            await prev;
            try {
                const fs = require("fs"), path = require("path"), os = require("os");
                const regPath = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "folder-groups.json");
                const saveReg = reg => { const tmp = regPath + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(reg, null, 2)); fs.renameSync(tmp, regPath); };
                let reg = {};
                let raw = null;
                try { raw = fs.readFileSync(regPath, "utf8"); } catch {}
                if (raw !== null) {
                    try { reg = JSON.parse(raw); } catch { reg = null; }
                    if (!reg || typeof reg !== "object" || Array.isArray(reg)) {
                        // never overwrite the only record of stripped group names - set it aside
                        try { fs.copyFileSync(regPath, regPath + ".corrupt-" + Date.now()); } catch {}
                        try { console.error("[enhancer] P15: folder-groups.json unreadable, preserved as .corrupt-*"); } catch {}
                        reg = {};
                    }
                }
                if (!Array.isArray(list) || !self.settings) return;

                // 0. The sidebar and the chat panel load their lists at the same moment. If another
                // call changed titles/groups/archive while this list was being built or while it
                // waited on the lock, the list is stale - showing it would put the old titles back
                // on screen and re-renaming would append the same title line twice. Rebuild it from
                // disk with the extension's own builder and update it in place.
                if (typeof genAtBuild === "number" && (globalThis.__folderGroupsGen || 0) !== genAtBuild && typeof self.buildSessionList === "function") {
                    const fresh = await self.buildSessionList();
                    if (Array.isArray(fresh)) list.splice(0, list.length, ...fresh);
                }

                // 1. harvest "[Name] rest" titles. [s] belongs to sync-shared.ps1 - leave it alone.
                const strip = [];
                let titlesChanged = false;
                for (const s of list) {
                    const m = typeof s.customTitle === "string" && /^\s*\[([^\]]+)\]\s*(.*)$/.exec(s.customTitle);
                    if (!m) continue;
                    const name = m[1].trim().slice(0, 100), rest = m[2].trim();
                    if (!name || name.toLowerCase() === "s" || !rest) continue;
                    if (!reg[s.id] || reg[s.id].group !== name) reg[s.id] = { group: name, appliedIn: [] };
                    strip.push([s, rest]);
                }
                // the group name must be on disk BEFORE the title loses it
                if (strip.length) saveReg(reg);
                for (const [s, rest] of strip) {
                    try {
                        const r = await self.renameSession(s.id, rest);
                        if (!r || !r.skipped) { s.customTitle = rest; titlesChanged = true; }
                    } catch (e) { try { console.error("[enhancer] P15 rename failed:", s.id, e); } catch {} }
                }

                // 2. apply the registry once per project scope
                const scope = typeof self.settings.sessionGroupsKey === "function" ? self.settings.sessionGroupsKey() : "default";
                const byId = new Map(list.map(s => [s.id, s]));
                const todo = Object.entries(reg).filter(([id, r]) => r && r.group && byId.has(id) && !(Array.isArray(r.appliedIn) && r.appliedIn.includes(scope)));
                let groupsChanged = false;
                if (todo.length) {
                    // archived chats cannot be in a group (2.1.280 strips them), so unarchive first.
                    // Native unarchive also removes them from groups, hence before grouping.
                    const archived = new Set(self.settings.getArchivedSessionIds() || []);
                    const toUnarchive = todo.map(([id]) => id).filter(id => archived.has(id));
                    if (toUnarchive.length) await self.unarchiveSessions(toUnarchive);

                    // First application in this project: the [Name] the user typed wins, so move the
                    // chat there (a chat can be in one group only). Afterwards the scope is recorded
                    // in appliedIn and manual regrouping in the UI is never overridden. A NEW prefix
                    // typed later resets appliedIn (step 1), so it moves again, in every project.
                    const groups = (self.settings.getSessionGroups() || []).map(g => ({ ...g, sessionIds: [...g.sessionIds] }));
                    for (const [id, r] of todo) {
                        let g = groups.find(x => String(x.name).toLowerCase() === r.group.toLowerCase());
                        if (!g) { g = { id: require("crypto").randomUUID(), name: r.group, collapsed: false, sessionIds: [] }; groups.push(g); }
                        for (const other of groups) if (other !== g) other.sessionIds = other.sessionIds.filter(x => x !== id);
                        if (!g.sessionIds.includes(id)) g.sessionIds.push(id);
                        r.appliedIn = [...(Array.isArray(r.appliedIn) ? r.appliedIn : []), scope];
                    }
                    await self.updateSessionGroups(groups);
                    saveReg(reg);
                    groupsChanged = true;
                }

                // 3. this list may predate changes another call just made (the sidebar and the chat
                // panel load at the same moment): take archive state from the store, not the list.
                const archivedNow = new Set(self.settings.getArchivedSessionIds() || []);
                for (const s of list) if (typeof s.archived === "boolean") s.archived = archivedNow.has(s.id);

                // 4. every webview must re-read groups once after any change - including one whose
                // group fetch happened before the change and whose list load waited on the lock.
                if (groupsChanged || titlesChanged) globalThis.__folderGroupsGen = (globalThis.__folderGroupsGen || 0) + 1;
                const gen = globalThis.__folderGroupsGen || 0;
                const comms = globalThis.__folderGroupsComms || (globalThis.__folderGroupsComms = new Set());
                comms.add(self);
                if (gen > 0) for (const c of comms) {
                    if ((c.__folderGroupsSeen || 0) >= gen) continue;
                    c.__folderGroupsSeen = gen;
                    try { c.sendSessionGroupsChanged && c.sendSessionGroupsChanged(); } catch { comms.delete(c); }
                }
            } finally { release(); }
        }
        let p15 = false;
        // __fgGen is read BEFORE the list is built, so the hook can tell a list built while another
        // call was changing things (see step 0 in the hook).
        ejsContent = ejsContent.replace(/async readSessionList\(\)\{let ([a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\(\)),([a-zA-Z0-9_$]+)=await this\.buildSessionList\(\);/, (match, first, listVar) => {
            p15 = true;
            return `async readSessionList(){let ${first},__fgGen=globalThis.__folderGroupsGen||0,${listVar}=await this.buildSessionList();try{await (${folderGroupsHook.toString()})(this,${listVar},__fgGen)}catch(__e){try{console.error("[enhancer] P15 folder-groups failed:",__e)}catch{}}`;
        });
        if (p15) console.log(`      \x1b[32m✔ P15 ([Folder] title -> native group): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P15 ([Folder] title -> native group): Not found\x1b[0m`); failures.push(`${appName}: P15 - not found`); }

        // P16: heal chat titles that drifted out of reach (successor to P6, see #93115).
        // Every 2.1.x build finds a chat's title by reading only the first and last 64 KB of the
        // transcript. Once a chat grows 64 KB past its last title record, the list, the tab, the
        // CLI and the auto-titler all stop seeing the title (the auto-titler may then overwrite
        // it). P6 used to raise the window to 1 MB - slow on every list load, and still broken
        // past 1 MB (chats here reach 50 MB). Instead: remember titles in
        // ~/.claude/session-titles.json (seeded by the installer, refreshed from every list load)
        // and, when a remembered chat comes back without its title, re-append the file's own
        // latest title record so it is back inside the window for EVERY reader. The file is the
        // source of truth; the memory only says "this chat has a title - check it". Append-only,
        // modified time restored so the chat does not jump to the top. Never throws into the
        // list load. Runs before P15, so a drifted "[Name]" title still gets grouped.
        async function titleHealHook(self, list) {
            const prev = globalThis.__titleHealLock || Promise.resolve();
            let release;
            globalThis.__titleHealLock = new Promise(r => { release = r; });
            await prev;
            try {
                if (!Array.isArray(list)) return;
                const fs = require("fs"), path = require("path"), os = require("os");
                const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
                const memPath = path.join(cfg, "session-titles.json"), projRoot = path.join(cfg, "projects");
                const WINDOW = 65536;
                let mem = {}, raw = null, dirty = false;
                try { raw = fs.readFileSync(memPath, "utf8"); } catch {}
                if (raw !== null) {
                    try { mem = JSON.parse(raw); } catch { mem = null; }
                    if (!mem || typeof mem !== "object" || Array.isArray(mem)) {
                        try { fs.copyFileSync(memPath, memPath + ".corrupt-" + Date.now()); } catch {}
                        mem = {};
                    }
                }
                // one readdir per project folder per load: where each chat lives, and which of
                // those places also has the 2.1.280 title sidecar <dir>/<id>/custom-title.json
                const index = [];
                try {
                    for (const d of fs.readdirSync(projRoot, { withFileTypes: true })) {
                        if (!d.isDirectory() || d.name === "backup") continue;
                        try { index.push([path.join(projRoot, d.name), new Set(fs.readdirSync(path.join(projRoot, d.name)))]); } catch {}
                    }
                } catch {}
                const homesOf = id => index.filter(([, names]) => names.has(id + ".jsonl")).map(([dir]) => dir);
                const sidecarsOf = id => index.filter(([, names]) => names.has(id + ".jsonl") && names.has(id))
                    .map(([dir]) => path.join(dir, id, "custom-title.json")).filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
                const sidecarTitle = p => { try { const o = JSON.parse(fs.readFileSync(p, "utf8")); return o && typeof o.customTitle === "string" ? o.customTitle : null; } catch { return null; } };
                const lastTitleIn = text => {
                    let last = null;
                    for (const line of text.split("\n")) {
                        if (!line.includes('"custom-title"')) continue;
                        try { const o = JSON.parse(line); if (o && o.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle) last = o.customTitle; } catch {}
                    }
                    return last;
                };
                for (const s of list) {
                    if (!s || typeof s.id !== "string") continue;
                    const seen = typeof s.customTitle === "string" && s.customTitle ? s.customTitle : null;
                    const known = typeof mem[s.id] === "string" ? mem[s.id] : null;
                    if (!known && !seen) continue;                              // never had a title
                    const sidecars = sidecarsOf(s.id);
                    const expect = seen || known;
                    const staleSidecar = sidecars.some(p => sidecarTitle(p) !== expect);
                    if (known && seen === known && !staleSidecar) continue;     // all consistent - no I/O
                    if (!known && !staleSidecar) { mem[s.id] = seen; dirty = true; continue; } // first sighting
                    // something disagrees: the transcript's own latest title record decides
                    const homes = homesOf(s.id);
                    if (!homes.length) continue;
                    let file, st, buf;
                    try { file = fs.realpathSync(path.join(homes[0], s.id + ".jsonl")); st = fs.statSync(file); if (!st.isFile()) continue; buf = fs.readFileSync(file); } catch { continue; }
                    const last = lastTitleIn(buf.toString("utf8"));
                    if (!last) continue;
                    // the native reader checks the tail window, then the sidecar, then the head window;
                    // re-appending puts the latest title in the tail, which beats a stale sidecar too
                    const rec = '"customTitle":' + JSON.stringify(last);
                    const inTail = buf.subarray(Math.max(0, buf.length - WINDOW)).toString("utf8").includes(rec);
                    const inHead = buf.subarray(0, WINDOW).toString("utf8").includes(rec);
                    // not in the tail => the tail holds no title at all; the reader then uses a sidecar
                    // if there is one, else the head. Append unless the head alone already shows it.
                    if (!inTail && !(inHead && !sidecars.length)) {
                        try {
                            const sep = buf.length && buf[buf.length - 1] !== 10 ? "\n" : "";
                            fs.appendFileSync(file, sep + JSON.stringify({ type: "custom-title", customTitle: last, sessionId: s.id }) + "\n");
                            try { fs.utimesSync(file, st.atime, st.mtime); } catch {}
                            try { console.log("[enhancer] P16 re-appended drifted title:", s.id, JSON.stringify(last)); } catch {}
                        } catch (e) { try { console.error("[enhancer] P16 heal failed:", s.id, e); } catch {} continue; }
                    }
                    for (const p of sidecars) {
                        if (sidecarTitle(p) === last) continue;
                        try {
                            const tmp = p + ".tmp";
                            fs.writeFileSync(tmp, JSON.stringify({ customTitle: last })); fs.renameSync(tmp, p);
                            try { console.log("[enhancer] P16 corrected stale title sidecar:", p, JSON.stringify(last)); } catch {}
                        } catch (e) { try { console.error("[enhancer] P16 sidecar fix failed:", p, e); } catch {} }
                    }
                    s.customTitle = last;
                    if (mem[s.id] !== last) { mem[s.id] = last; dirty = true; }
                }
                if (dirty) { const tmp = memPath + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(mem, null, 1)); fs.renameSync(tmp, memPath); }
            } finally { release(); }
        }
        let p16 = false;
        ejsContent = ejsContent.replace(/(async readSessionList\(\)\{let [^;]*?([a-zA-Z0-9_$]+)=await this\.buildSessionList\(\);)/, (match, head, listVar) => {
            p16 = true;
            return `${head}try{await (${titleHealHook.toString()})(this,${listVar})}catch(__e){try{console.error("[enhancer] P16 title-heal failed:",__e)}catch{}}`;
        });
        if (p16) console.log(`      \x1b[32m✔ P16 (heal drifted chat titles): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P16 (heal drifted chat titles): Not found\x1b[0m`); failures.push(`${appName}: P16 - not found`); }

        // P17: boot watchdog for chat panels restored on a cold start.
        // Traced 2026-09-24 (P_diag): the editor restores every open chat panel and the extension
        // gives each its HTML, but on a cold start some webviews never start - no message at all,
        // and clicking the tab again does not revive them. Which chat loses the race changes from
        // start to start. Only a NEW webview fixes it (the user had to close + reopen by hand).
        // So: if a restored panel has not sent its first message 8 s after being visible, reload
        // its HTML; if it is still silent 8 s later, close it and reopen the same chat through the
        // command the session list's "open" uses (claude-vscode.editor.open). A panel that has
        // spoken is never touched; at most one reload + one reopen per panel.
        let p17 = false;
        ejsContent = ejsContent.replace(/([a-zA-Z0-9_$]+)\.window\.registerWebviewPanelSerializer\("claudeVSCodePanel",\{async deserializeWebviewPanel\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)\{/, (match, vs, panel, state) => {
            p17 = true;
            return `${match}try{const __sid=(${state}&&typeof ${state}.sessionID==="string")?${state}.sessionID:null;let __spoke=false,__tries=0,__t=null;` +
                `${panel}.webview.onDidReceiveMessage(()=>{__spoke=true});` +
                `const __check=()=>{__t=null;if(__spoke)return;if(!${panel}.visible)return;__tries++;` +
                    `if(__tries===1){try{console.warn("[enhancer] P17 chat panel silent after 8s, reloading its content:",__sid);${panel}.webview.html=${panel}.webview.html+"<!-- enhancer P17 reload -->"}catch{}__t=setTimeout(__check,8000);return}` +
                    `if(__tries===2&&__sid){try{console.warn("[enhancer] P17 chat panel still silent, reopening:",__sid)}catch{}try{${panel}.dispose()}catch{}` +
                    `setTimeout(()=>{try{Promise.resolve(${vs}.commands.executeCommand("claude-vscode.editor.open",__sid,void 0,void 0,void 0,!0,{programmatic:"honor-preferred-location"})).catch(()=>{})}catch{}},300)}};` +
                `__t=setTimeout(__check,8000);` +
                // a webview only starts once shown, so becoming visible restarts the 8 s clock
                `${panel}.onDidChangeViewState(e=>{if(!__spoke&&e.webviewPanel.visible&&__tries<2){if(__t)clearTimeout(__t);__t=setTimeout(__check,8000)}});` +
                `${panel}.onDidDispose(()=>{__spoke=true;if(__t){clearTimeout(__t);__t=null}})}catch{}`;
        });
        if (p17) console.log(`      \x1b[32m✔ P17 (restored chat panel boot watchdog): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P17 (restored chat panel boot watchdog): Not found\x1b[0m`); failures.push(`${appName}: P17 - not found`); }

        // P_diag (DIAGNOSTIC ONLY, off unless ENHANCER_DIAG=1): trace chat-panel restore on startup.
        // Some restored chat panels come up blank on a cold start and never send a single message.
        // For each panel the editor restores, log to ~/.claude/panel-restore-diag.log when
        // deserializeWebviewPanel is called (session, visible, active, column), when the panel's
        // webview sends its first message (= it booted), view-state changes and disposal. Lines
        // carry the extension-host pid, which maps to a window via exthost.log. No behaviour change.
        if (process.env.ENHANCER_DIAG === '1') {
            let pDiag = false;
            ejsContent = ejsContent.replace(/registerWebviewPanelSerializer\("claudeVSCodePanel",\{async deserializeWebviewPanel\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)\{/, (match, panel, state) => {
                pDiag = true;
                return `${match}try{const __f=require("fs"),__p=require("path"),__L=__p.join(require("os").homedir(),".claude","panel-restore-diag.log"),__NL=String.fromCharCode(10);` +
                    `const __w=m=>{try{__f.appendFileSync(__L,new Date().toISOString()+" pid"+process.pid+" "+m+__NL)}catch{}};` +
                    `const __s=(${state}&&${state}.sessionID)||"?";` +
                    `__w("deserialize session="+__s+" visible="+${panel}.visible+" active="+${panel}.active+" col="+${panel}.viewColumn+" title="+JSON.stringify(${panel}.title));` +
                    `let __b=false;${panel}.webview.onDidReceiveMessage(()=>{if(!__b){__b=true;__w("first-message session="+__s)}});` +
                    `${panel}.onDidChangeViewState(e=>__w("viewstate session="+__s+" visible="+e.webviewPanel.visible+" active="+e.webviewPanel.active));` +
                    `${panel}.onDidDispose(()=>__w("disposed session="+__s))}catch{}`;
            });
            console.log(pDiag ? `      \x1b[36mℹ P_diag (panel-restore trace -> ~/.claude/panel-restore-diag.log): Applied\x1b[0m` : `      \x1b[33m⚠ P_diag: anchor not found\x1b[0m`);
        }

        // P12 (wjs): isShared signal setup
        let p12WjsA = false;
        wjsContent = wjsContent.replace(/teleportedFromSessionId=([a-zA-Z0-9_$]+)\(\(?void 0\)?\);teleportedMessageCount/g, (match, lt) => {
            p12WjsA = true;
            return `teleportedFromSessionId=${lt}(void 0);isShared=${lt}(!1);teleportedMessageCount`;
        });
        if (p12WjsA) console.log(`      \x1b[32m✔ P12_wjs_a (isShared state signal): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P12_wjs_a (isShared state signal): Not found\x1b[0m`); failures.push(`${appName}: P12_wjs_a - not found`); }

        let p12WjsB = false;
        wjsContent = wjsContent.replace(/\)([a-zA-Z0-9_$]+)\.teleportedFromSessionId\.value=([a-zA-Z0-9_$]+)\.teleportedFromSessionId;if\(\2\.teleportedMessageCount/g, (match, nVar, eVar) => {
            p12WjsB = true;
            return `)${nVar}.teleportedFromSessionId.value=${eVar}.teleportedFromSessionId;if(${eVar}.isShared!==void 0)${nVar}.isShared.value=${eVar}.isShared;if(${eVar}.teleportedMessageCount`;
        });
        if (p12WjsB) console.log(`      \x1b[32m✔ P12_wjs_b (isShared server assignment): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P12_wjs_b (isShared server assignment): Not found\x1b[0m`); failures.push(`${appName}: P12_wjs_b - not found`); }
        
        // P12 (wjs): italic render
        let p12WjsC = false;
        // 2.1.280: the createElement alias changed (b -> F) and the call gained a trailing key
        // argument (,"view"). Capture both instead of hardcoding, so the next rename is survivable.
        wjsContent = wjsContent.replace(/([a-zA-Z0-9_$]+)\("span",\{className:([a-zA-Z0-9_$]+)\.sessionName,children:([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+)\)\}(,"[a-z]+")?\)/g, (match, createFn, gn, yQe, FD, tVar, rVar, keyArg) => {
            p12WjsC = true;
            const key = keyArg || '';
            // Whole title in italics. It used to style only the "[Group]" prefix, but P15 now moves
            // that prefix into a native group and strips it, so there is often no prefix left.
            return `${createFn}("span",{className:${gn}.sessionName,children:(()=>{let _t=${FD}(${tVar});if(${tVar}.isShared&&${tVar}.isShared.value)return ${createFn}("em",{children:${yQe}(_t,${rVar})});return ${yQe}(_t,${rVar})})()}${key})`;
        });
        if (p12WjsC) console.log(`      \x1b[32m✔ P12_wjs_c (isShared italic rendering): Applied\x1b[0m`);
        else { console.log(`      \x1b[31m✘ P12_wjs_c (isShared italic rendering): Not found\x1b[0m`); failures.push(`${appName}: P12_wjs_c - not found`); }
        } else console.log(`      ${YELLOW}⊘ P13, P13_panel, P12*: stage C (not applied at stage ${STAGE})${RESET}`);
        
        fs.writeFileSync(wjs, wjsContent);
        checkSyntax(wjs, "webview patches");

        fs.writeFileSync(ejs, ejsContent);
        checkSyntax(ejs, "extension.js patches");
        
        const safeBackupDir = path.join(homedir, '.claude', 'claude-patches', `v${ver}`);
        if (!fs.existsSync(safeBackupDir)) fs.mkdirSync(safeBackupDir, { recursive: true });
        const nameSlug = appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        fs.copyFileSync(ejs, path.join(safeBackupDir, `extension-${nameSlug}.js`));
        fs.copyFileSync(wjs, path.join(safeBackupDir, `webview-index-${nameSlug}.js`));
        fs.copyFileSync(pkg, path.join(safeBackupDir, `package-${nameSlug}.json`));
        
        console.log(`    ${GREEN}✔ ${appName} patched & backed up successfully!${RESET}`);
    }
    
    // [5/7] Edge cache-warming boot task - RETIRED 31 Jul 2026, with the Edge bridge.
    // It launched Edge minimized at login, waited 8s for a usage POST, then ran
    // `taskkill /f /im msedge.exe` - which force-killed EVERY Edge window, not just
    // the one it opened. Usage is now fetched natively, so there is nothing to warm.
    const patchesDir = path.join(homedir, '.claude', 'claude-patches');
    if (!fs.existsSync(patchesDir)) fs.mkdirSync(patchesDir, { recursive: true });

    if (DEPLOY_EDGE_EXT) {
        console.log(`\n${BOLD}[5/7] Registering silent Windows Startup script...${RESET}`);
        const batPath = path.join(patchesDir, 'startup-usage-refresh.bat');
        const vbsPath = path.join(patchesDir, 'startup-usage-refresh.vbs');
        fs.writeFileSync(batPath, `@echo off\nstart "" /min msedge.exe --minimized "https://claude.ai"\ntimeout /t 8 /nobreak >nul\ntaskkill /f /im msedge.exe\n`, 'utf8');
        fs.writeFileSync(vbsPath, `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${batPath.replace(/\\/g, '\\\\')}", 0, True\n`, 'utf8');

        const startupLnkPath = path.join(homedir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ClaudeUsageStartup.lnk');
        const psCommand = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${startupLnkPath.replace(/'/g, "''")}'); $Shortcut.TargetPath = 'wscript.exe'; $Shortcut.Arguments = '"${vbsPath.replace(/'/g, "''")}"'; $Shortcut.IconLocation = 'msedge.exe, 0'; $Shortcut.Save();`;
        execSync(`powershell -Command "${psCommand}"`, { stdio: 'ignore' });
        console.log(`  ${GREEN}✔ Windows startup shortcut placed${RESET}`);
    } else {
        console.log(`\n${BOLD}[5/7] Edge boot task: ${RESET}${YELLOW}skipped (retired - would taskkill all Edge windows)${RESET}`);
    }

    // Deploy the shared-session sync script that the extension spawns on activation.
    // The repo is its source of truth - ~/.claude/projects/ is not version controlled,
    // so the only copy used to be the live one.
    const syncSrc = path.join(__dirname, 'sync-shared.ps1');
    const syncDest = path.join(homedir, '.claude', 'projects', 'sync-shared.ps1');
    if (fs.existsSync(syncSrc)) {
        const syncDestDir = path.dirname(syncDest);
        if (!fs.existsSync(syncDestDir)) fs.mkdirSync(syncDestDir, { recursive: true });
        const incoming = fs.readFileSync(syncSrc, 'utf8');
        const current = fs.existsSync(syncDest) ? fs.readFileSync(syncDest, 'utf8') : null;
        if (current === incoming) {
            console.log(`  ${GREEN}✔ sync-shared.ps1 already current${RESET}`);
        } else {
            if (current !== null) fs.writeFileSync(`${syncDest}.bak`, current, 'utf8');
            fs.writeFileSync(syncDest, incoming, 'utf8');
            console.log(`  ${GREEN}✔ Deployed sync-shared.ps1${RESET}${current !== null ? ` ${YELLOW}(previous copy saved as sync-shared.ps1.bak)${RESET}` : ''}`);
        }
    }
    
    console.log(`\n${BOLD}[6/7] Protecting sessions from auto-cleanup...${RESET}`);
    const settingsPath = path.join(homedir, '.claude', 'settings.json');
    try {
        let settings = {};
        if (fs.existsSync(settingsPath)) settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!settings.cleanupPeriodDays || settings.cleanupPeriodDays < 9999) {
            settings.cleanupPeriodDays = 9999;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
            console.log(`  ${GREEN}✔ Set cleanupPeriodDays=9999${RESET}`);
        }
    } catch (e) {}
    
    // P16 needs to know which chats have a title. Seed ~/.claude/session-titles.json from every
    // real transcript's LAST custom-title record (read-only on the chats), so titles that already
    // drifted out of the 64 KB window get healed on the next list load. File beats memory.
    if (stage('C')) {
        try {
            const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude');
            const projRoot = path.join(cfgDir, 'projects'), memPath = path.join(cfgDir, 'session-titles.json');
            let mem = {};
            if (fs.existsSync(memPath)) {
                try { mem = JSON.parse(fs.readFileSync(memPath, 'utf8')); } catch { mem = null; }
                if (!mem || typeof mem !== 'object' || Array.isArray(mem)) {
                    fs.copyFileSync(memPath, `${memPath}.corrupt-${Date.now()}`);
                    mem = {};
                }
            }
            let titled = 0, drifted = 0;
            for (const d of fs.existsSync(projRoot) ? fs.readdirSync(projRoot, { withFileTypes: true }) : []) {
                if (!d.isDirectory() || d.name === 'backup') continue;
                for (const f of fs.readdirSync(path.join(projRoot, d.name))) {
                    if (!f.endsWith('.jsonl')) continue;
                    const p = path.join(projRoot, d.name, f);
                    if (fs.lstatSync(p).isSymbolicLink()) continue;
                    const buf = fs.readFileSync(p);
                    let last = null;
                    for (const line of buf.toString('utf8').split('\n')) {
                        if (!line.includes('"custom-title"')) continue;
                        try { const o = JSON.parse(line); if (o && o.type === 'custom-title' && typeof o.customTitle === 'string' && o.customTitle) last = o.customTitle; } catch {}
                    }
                    if (!last) continue;
                    titled++;
                    mem[f.slice(0, -6)] = last;
                    const rec = '"customTitle":' + JSON.stringify(last), W = 65536;
                    if (!buf.subarray(Math.max(0, buf.length - W)).toString('utf8').includes(rec) && !buf.subarray(0, W).toString('utf8').includes(rec)) drifted++;
                }
            }
            const tmp = `${memPath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(mem, null, 1)); fs.renameSync(tmp, memPath);
            console.log(`  ${GREEN}✔ P16 title memory: ${titled} titled chats${RESET}${drifted ? ` ${YELLOW}(${drifted} out of reach - healed on next list load)${RESET}` : ''}`);
        } catch (e) {
            console.log(`  ${YELLOW}⚠ P16 title memory not seeded: ${e.message}${RESET}`);
        }
    }

    console.log(`\n${BOLD}[7/7] Setting up automated session backup...${RESET}`);
    console.log(`  ${GREEN}✔ Backup script & Scheduled task preserved${RESET}`);
    
    if (failures.length) {
        console.log(`\n${RED}${BOLD}====================================================`);
        console.log(`⚠ INSTALLER FINISHED WITH ${failures.length} PATCH FAILURE(S)`);
        console.log(`====================================================${RESET}`);
        failures.forEach(f => console.log(`  ${RED}✘ ${f}${RESET}`));
    } else {
        console.log(`\n${GREEN}${BOLD}====================================================`);
        console.log(`✔ All stage-${STAGE} patches injected`);
        console.log(`====================================================${RESET}`);
    }
    // "Injected" is not "working". Only a restart proves anything.
    console.log(`\n${BOLD}Next:${RESET} restart the editor, then check the status bar, an account swap and a POPULATED`);
    console.log(`session list. If anything is missing, read the NEWEST window's renderer.log for "[enhancer]"`);
    console.log(`and exthost/exthost.log for "Activating extension Anthropic.claude-code failed".`);
    if (STAGE !== 'C') console.log(`${YELLOW}Stage ${STAGE} only - rerun with the next ENHANCER_STAGE once this one is verified.${RESET}`);
    console.log('');
    if (failures.length) process.exitCode = 2;
    
} catch (error) {
    console.error(`\n${RED}${BOLD}====================================================`);
    console.error(`❌ INSTALLATION FAILED!`);
    console.error(`====================================================${RESET}`);
    console.error(error.message);
    process.exit(1);
}
