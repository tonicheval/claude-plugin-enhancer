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

try {
    const homedir = os.homedir();
    
    console.log(`${BOLD}[1/7] Detecting Claude Code extension folders...${RESET}`);
    const potentialBases = [
        { name: "Void Editor", path: path.join(homedir, '.void-editor', 'extensions') },
        { name: "VS Code", path: path.join(homedir, '.vscode', 'extensions') },
        { name: "Cursor", path: path.join(homedir, '.cursor', 'extensions') }
    ];
    
    const targets = [];
    
    for (const app of potentialBases) {
        if (fs.existsSync(app.path)) {
            const dirs = fs.readdirSync(app.path)
                .filter(d => d.startsWith('anthropic.claude-code-') && fs.statSync(path.join(app.path, d)).isDirectory());
            
            if (dirs.length > 0) {
                dirs.sort((a, b) => fs.statSync(path.join(app.path, b)).mtimeMs - fs.statSync(path.join(app.path, a)).mtimeMs);
                targets.push({ appName: app.name, extVersion: dirs[0], extDir: path.join(app.path, dirs[0]) });
            }
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
            }
        }
        
        function applyRegex(fileContent, regex, newStr, label, isOptional = false) {
            if (!regex.test(fileContent)) {
                if (isOptional) {
                    console.log(`      ${YELLOW}⚠ Skipping optional patch (not found): ${label}${RESET}`);
                    return fileContent;
                } else {
                    console.error(`      ${RED}✘ Marker not found: ${label}${RESET}`);
                    return fileContent;
                }
            }
            let updated = fileContent.replace(regex, newStr);
            console.log(`      ${GREEN}✔ ${label}: Applied${RESET}`);
            return updated;
        }

        // P1: package.json sidebar always visible
        pkgContent = applyRegex(pkgContent, /"when": "claude-vscode.sessionsListEnabled"/g, '"when": "true"', 'P1 (Sidebar visible)');
        fs.writeFileSync(pkg, pkgContent);
        
        // P2: Webview initialization realpathSync bypass (Symlink fix for frontend)
        let p2Found = false;
        ejsContent = ejsContent.replace(/([a-zA-Z0-9_$]+)\.realpathSync\(([a-zA-Z0-9_$]+)\[0\]\|\|([a-zA-Z0-9_$]+)\.homedir\(\)\)\.normalize\("NFC"\)/g, (match, fsVar, p1, p2) => {
            p2Found = true;
            return `(${p1}[0]||${p2}.homedir()).normalize("NFC")`;
        });
        if (p2Found) console.log(`      \x1b[32m✔ P2 (Webview realpath): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P2 (Webview realpath): Not found\x1b[0m`);

        // P3: Extension realpathSync bypass (Network drive & hash fix for backend)
        let p3Found = false;
        let p3FuncName = '';
        ejsContent = ejsContent.replace(/function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{let [a-zA-Z0-9_$]+=([a-zA-Z0-9_$]+)\.resolve\([a-zA-Z0-9_$]+\?\?"\."\),[a-zA-Z0-9_$]+;try\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.realpathSync\([a-zA-Z0-9_$]+\)\}catch\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\}return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)\}/g, (match, funcName, argName, pathName, normalizeFuncName) => {
            p3Found = true;
            p3FuncName = funcName;
            return `function ${funcName}(${argName}){return ${normalizeFuncName}(${pathName}.resolve(${argName}??"."))}`; 
        });
        if (p3Found) console.log(`      \x1b[32m✔ P3 (Backend realpath): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P3 (Backend realpath): Not found\x1b[0m`);

        // P3_cwd: Normalize global cwd so listSessions and startSession hash match identically
        let p3cwdFound = false;
        if (p3FuncName) {
            ejsContent = ejsContent.replace(/this\.cwd=([a-zA-Z0-9_$]+)(;|})/g, (match, p1, p2) => {
                p3cwdFound = true;
                return `this.cwd=typeof ${p3FuncName}==="function"?${p3FuncName}(${p1}):${p1}${p2}`;
            });
        }
        if (p3cwdFound) console.log(`      \x1b[32m✔ P3_cwd (Normalize global cwd): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P3_cwd (Normalize global cwd): Not found\x1b[0m`);
        
        // P3b: Kie() async realpath bypass (hangs on mapped/network drives when listing sessions)
        let p3bFound = false;
        ejsContent = ejsContent.replace(/async function ([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\)\{try\{return ([a-zA-Z0-9_$]+)\(await ([a-zA-Z0-9_$]+)\.realpath\([a-zA-Z0-9_$]+\)\)\}catch\{return ([a-zA-Z0-9_$]+)\([a-zA-Z0-9_$]+\)\}\}/g, (match, funcName, argName, cfFunc, soVar, cfFunc2) => {
            p3bFound = true;
            return `async function ${funcName}(${argName}){return ${cfFunc}(${argName})}`; 
        });
        if (p3bFound) console.log(`      \x1b[32m✔ P3b (Async session dir realpath): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P3b (Async session dir realpath): Not found\x1b[0m`);
        

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

        // P8: Advanced Multi-Window Usage status bar HTTP server & Session Size Monitor
        const usageIIFE = '(()=>{const _http=require("http");const _https=require("https");const _fs=require("fs");const _os=require("os");const _path=require("path");const _credsPath=_path.join(_os.homedir(),".claude",".credentials.json");const _markerPath=_path.join(_os.homedir(),".claude",".active_account");const _cfgPath=_path.join(_os.homedir(),".claude.json");function _readJsonSafe(p){try{return JSON.parse(_fs.readFileSync(p,"utf8"));}catch{return null;}}function _getActiveOrgId(){try{const creds=JSON.parse(_fs.readFileSync(_credsPath,"utf8"));return creds.organizationUuid;}catch{return undefined;}}function _getActiveAccountNum(){try{const n=_fs.readFileSync(_markerPath,"utf8").trim();if(n==="1"||n==="2")return n;}catch{}return null;}function _liveAccountUuid(){try{const c=_readJsonSafe(_cfgPath);return c&&c.oauthAccount&&c.oauthAccount.accountUuid||null;}catch{return null;}}function _slotAccountUuid(n){try{const b=_readJsonSafe(_path.join(_os.homedir(),".claude",".credentials_account"+n+".json"));return b&&b.oauthAccount&&b.oauthAccount.accountUuid||null;}catch{return null;}}function _syncLiveTokenToActiveSlot(){try{const live=_readJsonSafe(_credsPath);if(!live||!live.claudeAiOauth)return;const liveUuid=_liveAccountUuid();if(!liveUuid)return;for(const n of ["1","2"]){if(_slotAccountUuid(n)!==liveUuid)continue;const p=_path.join(_os.homedir(),".claude",".credentials_account"+n+".json");const bk=_readJsonSafe(p)||{};const cur=bk.claudeAiOauth||{};if(cur.accessToken!==live.claudeAiOauth.accessToken||cur.refreshToken!==live.claudeAiOauth.refreshToken){bk.claudeAiOauth=live.claudeAiOauth;if(live.organizationUuid)bk.organizationUuid=live.organizationUuid;_fs.writeFileSync(p,JSON.stringify(bk,null,2),"utf8");}return;}}catch{}}function _reconcileActiveSlot(){try{const live=_liveAccountUuid();if(!live)return;const u1=_slotAccountUuid("1"),u2=_slotAccountUuid("2");if(u1&&u2&&u1===u2)return;let real=null;if(u1&&u1===live)real="1";else if(u2&&u2===live)real="2";if(!real)return;if(_getActiveAccountNum()!==real){_fs.writeFileSync(_markerPath,real,"utf8");_lastKnownSlot=real;_usageFreshForSlot=null;}}catch{}}function _getUsageFile(){const accNum=_getActiveAccountNum();if(accNum==="1")return _path.join(_os.homedir(),".claude","usage_account1.json");if(accNum==="2")return _path.join(_os.homedir(),".claude","usage_account2.json");return _path.join(_os.homedir(),".claude","usage.json");}const _wu=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,9);_wu.command="claude-vscode.openUsage";_wu.tooltip="Claude usage";_wu.text="$(graph)Claude usage";_wu.show();e.subscriptions.push(_wu);e.subscriptions.push(Se.commands.registerCommand("claude-vscode.openUsage",()=>{ Se.env.openExternal(Se.Uri.parse("https://claude.ai/settings/usage"));}));const _wa=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,10);_wa.command="claude-vscode.swapAccount";_wa.tooltip="Swap Claude Account";_wa.text="$(account)Account Switcher";_wa.show();e.subscriptions.push(_wa);const _acc1Path=_path.join(_os.homedir(),".claude",".credentials_account1.json");const _acc2Path=_path.join(_os.homedir(),".claude",".credentials_account2.json");function _getAccountInfo(){ const accNum=_getActiveAccountNum(); if(accNum==="1")return{currentAcc:"Account 1",otherAccPath:_acc2Path,otherAccNum:"2"}; if(accNum==="2")return{currentAcc:"Account 2",otherAccPath:_acc1Path,otherAccNum:"1"}; return{currentAcc:"Unknown",otherAccPath:null,otherAccNum:null};}function _updateAccountSwitcher(){ const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo(); function _cd(ts){if(!ts)return "";const d=ts-Date.now();if(d<=0)return "(Expired!)";const days=Math.floor(d/86400000);if(days>0)return "("+days+"d)";return "("+Math.floor(d/3600000)+"h)";} const live=_readJsonSafe(_credsPath); const countdown=live&&live.claudeAiOauth?_cd(live.claudeAiOauth.refreshTokenExpiresAt):""; const cfg=_readJsonSafe(_cfgPath); const curName=cfg&&cfg.oauthAccount&&cfg.oauthAccount.displayName?cfg.oauthAccount.displayName:""; let label=currentAcc==="Unknown"?"Account ?":currentAcc; if(curName)label=label+": "+curName; _wa.text="$(account) "+label+(countdown?" "+countdown:""); const oth=otherAccPath?_readJsonSafe(otherAccPath):null; const othName=oth&&oth.oauthAccount&&oth.oauthAccount.displayName?" ("+oth.oauthAccount.displayName+")":""; const othCd=oth&&oth.claudeAiOauth?_cd(oth.claudeAiOauth.refreshTokenExpiresAt):""; _wa.tooltip=otherAccNum?("Signed in as "+label+" "+countdown+" - click to switch to Account "+otherAccNum+othName+" "+othCd):"Swap Claude Account";}function _isTokenExpired(oauthObj){ if(!oauthObj)return true; if(oauthObj.refreshTokenExpiresAt&&oauthObj.refreshTokenExpiresAt<Date.now())return true; if(!oauthObj.refreshToken&&oauthObj.expiresAt&&oauthObj.expiresAt<Date.now())return true; return false;}function _swapAccounts(silent=false){ const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo(); if(!otherAccPath||!_fs.existsSync(otherAccPath)){ if(!silent)Se.window.showErrorMessage("Cannot swap:Backup for account "+otherAccNum+" not found at "+otherAccPath); return; } try{ const currentCreds=JSON.parse(_fs.readFileSync(_credsPath,"utf8")); const currentCfg=_readJsonSafe(_cfgPath); const currentBackupPath=currentAcc==="Account 1"?_acc1Path:_acc2Path; if(currentAcc!=="Unknown"){ const bk={claudeAiOauth:currentCreds.claudeAiOauth}; if(currentCreds.organizationUuid)bk.organizationUuid=currentCreds.organizationUuid; if(currentCfg&&currentCfg.oauthAccount)bk.oauthAccount=currentCfg.oauthAccount; _fs.writeFileSync(currentBackupPath,JSON.stringify(bk,null,2),"utf8"); } const otherCreds=_readJsonSafe(otherAccPath); if(!otherCreds||!otherCreds.claudeAiOauth){ if(!silent)Se.window.showErrorMessage("Swap aborted: backup for account "+otherAccNum+" has no claudeAiOauth token."); return; } const targetExpired=_isTokenExpired(otherCreds.claudeAiOauth); currentCreds.claudeAiOauth=otherCreds.claudeAiOauth; if(targetExpired){ delete currentCreds.organizationUuid; }else{ if(otherCreds.organizationUuid)currentCreds.organizationUuid=otherCreds.organizationUuid; else delete currentCreds.organizationUuid; } _fs.writeFileSync(_credsPath,JSON.stringify(currentCreds,null,2),"utf8"); if(currentCfg){ try{_fs.writeFileSync(_cfgPath+".bak-swap-"+Date.now(),JSON.stringify(currentCfg,null,2),"utf8");}catch{} if(targetExpired){ delete currentCfg.oauthAccount; }else{ if(otherCreds.oauthAccount)currentCfg.oauthAccount=otherCreds.oauthAccount; else delete currentCfg.oauthAccount; } _fs.writeFileSync(_cfgPath,JSON.stringify(currentCfg,null,2),"utf8"); } if(!silent&&targetExpired){ Se.window.showWarningMessage("Account "+otherAccNum+" token has expired. Claude Code will prompt you to re-login. All identity data will be captured fresh."); }else if(!silent&&(!otherCreds.organizationUuid||!otherCreds.oauthAccount)){ Se.window.showWarningMessage("Account "+otherAccNum+" backup has no cached org identity. Claude will re-derive it from the token on load; swap away and back once to capture it."); } _fs.writeFileSync(_markerPath,otherAccNum,"utf8"); if(silent)return true; Se.commands.executeCommand("workbench.action.reloadWindow"); }catch(err){ if(!silent)Se.window.showErrorMessage("Swap failed:"+err.message); }}e.subscriptions.push(Se.commands.registerCommand("claude-vscode.swapAccount",()=>{ _swapAccounts(false);}));const _ws=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,8);_ws.command="claude-vscode.showSessionInfo";_ws.tooltip="Claude Session & JSONL File Size";_ws.text="$(comment-discussion) Session (0 KB)";_ws.show();e.subscriptions.push(_ws);let _curSessionId=null;let _curSessionTitle=null;let _curSessionFile=null;let _curSessionBytes=0;function _fmtSize(b){if(!b||b<=0)return "0 KB";if(b<1024)return b+" B";if(b<1024*1024)return(b/1024).toFixed(1)+" KB";return(b/(1024*1024)).toFixed(2)+" MB";}function _findJsonl(sid){ if(!sid)return null; const base=process.env.CLAUDE_CONFIG_DIR||_path.join(_os.homedir(),".claude"); const pdir=_path.join(base,"projects"); if(!_fs.existsSync(pdir))return null; try{const wf=Se.workspace.workspaceFolders;if(wf&&wf.length>0){const sanitized=String(wf[0].uri.fsPath).replace(/[^a-zA-Z0-9]/g,"-");const direct=_path.join(pdir,sanitized,sid+".jsonl");if(_fs.existsSync(direct))return direct;}}catch{} try{const dirs=_fs.readdirSync(pdir);for(const d of dirs){const cand=_path.join(pdir,d,sid+".jsonl");if(_fs.existsSync(cand))return cand;}}catch{} return null;}function _findLatestJsonl(){ const base=process.env.CLAUDE_CONFIG_DIR||_path.join(_os.homedir(),".claude"); const pdir=_path.join(base,"projects"); if(!_fs.existsSync(pdir))return null; let latest=null;let latestMtime=0; try{ const wf=Se.workspace.workspaceFolders; const targetDirs=[]; if(wf&&wf.length>0){const sanitized=String(wf[0].uri.fsPath).replace(/[^a-zA-Z0-9]/g,"-");targetDirs.push(_path.join(pdir,sanitized));} for(const d of _fs.readdirSync(pdir)){const full=_path.join(pdir,d);if(!targetDirs.includes(full))targetDirs.push(full);} for(const td of targetDirs){ if(!_fs.existsSync(td)||!_fs.statSync(td).isDirectory())continue; const files=_fs.readdirSync(td).filter(f=>f.endsWith(".jsonl")); for(const f of files){try{const fp=_path.join(td,f);const st=_fs.statSync(fp);if(st.mtimeMs>latestMtime){latestMtime=st.mtimeMs;latest={path:fp,sessionId:f.replace(/\\\\.jsonl$/,""),size:st.size,mtime:st.mtimeMs};}}catch{}} if(latest&&targetDirs.indexOf(td)===0)break; } }catch{} return latest;}function _updateSessionStatusBar(){ let fpath=_curSessionFile; if(!fpath&&_curSessionId){fpath=_findJsonl(_curSessionId);_curSessionFile=fpath;} if(!fpath&&!_curSessionId){const lat=_findLatestJsonl();if(lat){_curSessionId=lat.sessionId;fpath=lat.path;_curSessionFile=fpath;_curSessionBytes=lat.size;}} if(fpath&&_fs.existsSync(fpath)){try{const st=_fs.statSync(fpath);_curSessionBytes=st.size;}catch{}}else{_curSessionBytes=0;} const szStr=_fmtSize(_curSessionBytes); let title=_curSessionTitle; if(!title){title=_curSessionId?("Session "+_curSessionId.slice(0,8)):"New Session";} let displayTitle=title; if(displayTitle.length>22){displayTitle=displayTitle.slice(0,20)+"\\u2026";} const isHeavy=_curSessionBytes>=5*1024*1024; const isModerate=_curSessionBytes>=1*1024*1024; const icon=isHeavy?"$(warning)":(isModerate?"$(comment-discussion)":"$(comment-discussion)"); _ws.text=icon+" "+displayTitle+" ("+szStr+(isHeavy?" - Large!":"")+")"; let healthNote="\\\\u2705 **Context Health**: Healthy (< 1 MB). Minimal recurring token overhead."; if(isHeavy){healthNote="\\\\U0001F6A8 **Context Health**: Heavy Session (> 5 MB). Every message re-reads massive history. Run \\\\`/compact\\\\` or \\\\`/clear\\\\` to save quota!";} else if(isModerate){healthNote="\\\\u26A0\\\\uFE0F **Context Health**: Moderate Session (1\\u20135 MB, ~100k-250k tokens). Consider running \\\\`/compact\\\\` soon.";} const tip=new Se.MarkdownString(); tip.isTrusted=true;tip.supportThemeIcons=true; tip.appendMarkdown("### \\\\U0001F4AC Claude Code Active Session\\\\n\\\\n"); tip.appendMarkdown("**Title**: "+title+"\\\\n\\\\n"); tip.appendMarkdown("**Session ID**: \\\\`"+(_curSessionId||"None")+"\\\\`\\\\n\\\\n"); tip.appendMarkdown("**JSONL File Size**: "+szStr+" ("+_curSessionBytes.toLocaleString()+" bytes)\\\\n\\\\n"); if(fpath){tip.appendMarkdown("**File Path**: \\\\`"+fpath+"\\\\`\\\\n\\\\n");} tip.appendMarkdown(healthNote+"\\\\n\\\\n"); tip.appendMarkdown("---\\\\n*Click to open JSONL file or copy Session ID*"); _ws.tooltip=tip;}globalThis.__claudeActiveSessionUpdate=function(sid,title){ if(sid)_curSessionId=sid; if(title&&title!==_curSessionTitle)_curSessionTitle=title; _curSessionFile=null; _updateSessionStatusBar();};e.subscriptions.push(Se.commands.registerCommand("claude-vscode.showSessionInfo",async()=>{ const szStr=_fmtSize(_curSessionBytes); const items=[ {label:"$(file) Open Session JSONL File",description:szStr,detail:_curSessionFile||"No JSONL file found",action:"open_file"}, {label:"$(clippy) Copy Session ID",detail:_curSessionId||"No active session ID",action:"copy_id"}, {label:"$(clippy) Copy JSONL File Path",detail:_curSessionFile||"No JSONL file found",action:"copy_path"}, {label:"$(sparkle) Compact Session (/compact)",description:"Reduce context size while keeping summary",detail:"Type /compact in your Claude chat to compress large session context",action:"compact_info"} ]; const chosen=await Se.window.showQuickPick(items,{placeHolder:"Claude Session: "+(_curSessionTitle||_curSessionId||"Active Session")+" ("+szStr+")"}); if(!chosen)return; if(chosen.action==="open_file"&&_curSessionFile&&_fs.existsSync(_curSessionFile)){ try{const doc=await Se.workspace.openTextDocument(Se.Uri.file(_curSessionFile));await Se.window.showTextDocument(doc);}catch(err){Se.window.showErrorMessage("Could not open JSONL file: "+err.message);} }else if(chosen.action==="copy_id"&&_curSessionId){ await Se.env.clipboard.writeText(_curSessionId);Se.window.showInformationMessage("Copied Session ID to clipboard!"); }else if(chosen.action==="copy_path"&&_curSessionFile){ await Se.env.clipboard.writeText(_curSessionFile);Se.window.showInformationMessage("Copied JSONL path to clipboard!"); }else if(chosen.action==="compact_info"){ Se.window.showInformationMessage("To compact this session, type \'/compact\' in your Claude Code chat. This compresses the conversation history into a ~3-5 KB summary."); }}));function _fmtU(d){ try{ const p=Math.round(d.five_hour&&d.five_hour.utilization||0); const wk=Math.round(d.seven_day&&d.seven_day.utilization||0); let r=""; if(d.five_hour&&d.five_hour.resets_at){ const ms=new Date(d.five_hour.resets_at)-Date.now(); if(ms>0){const h=Math.floor(ms/3600000);const m=Math.floor((ms%3600000)/60000);if(h>0){r=" resets in "+h+" hr "+m+" min";}else{r=" resets in "+m+" min";}} } const blocks=Math.round(p/10); const full="\\u2588".repeat(Math.min(10,blocks)); const empty="\\u2591".repeat(Math.max(0,10-blocks)); return{text:full+empty+" "+p+"%"+r+" \\u2014 Weekly "+wk+"%",util:p}; }catch{return{text:"$(graph)Claude usage(err)",util:0};}}const _autoStatePath=_path.join(_os.homedir(),".claude",".autoswap_state.json");const _AUTO_THRESHOLD=95;const _AUTO_COOLDOWN_MS=1800000;let _usageFreshForSlot=null;function _winUtil(w){try{if(!w)return 0;if(w.resets_at&&new Date(w.resets_at).getTime()<=Date.now())return 0;return Math.round(w.utilization||0);}catch{return 0;}}function _peakUtil(d){try{return Math.max(_winUtil(d&&d.five_hour),_winUtil(d&&d.seven_day));}catch{return 0;}}function _otherHasHeadroom(n){try{const f=_path.join(_os.homedir(),".claude","usage_account"+n+".json");if(!_fs.existsSync(f))return true;return _peakUtil(_readJsonSafe(f))<_AUTO_THRESHOLD;}catch{return true;}}function _autoSwapAllowed(){try{const st=_readJsonSafe(_autoStatePath);if(st&&st.lastSwapAt&&(Date.now()-st.lastSwapAt)<_AUTO_COOLDOWN_MS)return false;}catch{}return true;}function _noteAutoSwap(){try{_fs.writeFileSync(_autoStatePath,JSON.stringify({lastSwapAt:Date.now()}),"utf8");}catch{}}let _autoReloadTimer=null;let _autoReloadFired=false;function _triggerAutoSwap(){ const info=_getAccountInfo(); if(!info.otherAccNum)return; if(!_autoSwapAllowed()){_autoReloadFired=true;return;} if(!_otherHasHeadroom(info.otherAccNum)){_autoReloadFired=true;Se.window.showWarningMessage("Claude quota reached, but Account "+info.otherAccNum+" is also at its limit - staying put.");return;} const swapped=_swapAccounts(true); if(swapped){ _noteAutoSwap();_autoReloadFired=true; _autoReloadTimer=setTimeout(()=>{Se.commands.executeCommand("workbench.action.reloadWindow");},5000); Se.window.showWarningMessage("Claude quota reached - swapped to Account "+info.otherAccNum+". Reloading in 5s...","Cancel Reload","Reload Now").then(sel=>{ if(sel==="Cancel Reload"){try{clearTimeout(_autoReloadTimer);}catch{}_swapAccounts(true);_updateAccountSwitcher();} else if(sel==="Reload Now"){try{clearTimeout(_autoReloadTimer);}catch{}Se.commands.executeCommand("workbench.action.reloadWindow");} }); }}function _fetchUsageNow(){ try{ const c=_readJsonSafe(_credsPath); if(!c||!c.claudeAiOauth||!c.claudeAiOauth.accessToken)return; const slot=_getActiveAccountNum(); const target=_getUsageFile(); const token=c.claudeAiOauth.accessToken; const req=_https.request("https://api.anthropic.com/api/oauth/usage",{method:"GET",headers:{"Authorization":"Bearer "+token,"anthropic-beta":"oauth-2025-04-20","Content-Type":"application/json"},timeout:15000},(r)=>{ let b="";r.on("data",(d)=>{b+=d;}); r.on("end",()=>{try{if(r.statusCode!==200)return;const u=JSON.parse(b);if(!u||!u.five_hour)return;if(_getActiveAccountNum()!==slot)return;_fs.writeFileSync(target,JSON.stringify(u),"utf8");_usageFreshForSlot=slot;_updateFromCacheRefactored();}catch{}}); }); req.on("error",()=>{});req.on("timeout",()=>{try{req.destroy();}catch{}});req.end(); const preq=_https.request("https://api.anthropic.com/api/oauth/profile",{method:"GET",headers:{"Authorization":"Bearer "+token,"anthropic-beta":"oauth-2025-04-20","Content-Type":"application/json"},timeout:15000},(pr)=>{ let pb="";pr.on("data",(d)=>{pb+=d;}); pr.on("end",()=>{ try{ if(pr.statusCode!==200)return; const pj=JSON.parse(pb); if(!pj||!pj.account||!pj.account.uuid)return; if(_getActiveAccountNum()!==slot)return; const curCfg=_readJsonSafe(_cfgPath)||{}; const liveOrg=pj.organization?.uuid||c.organizationUuid; const liveName=pj.account.display_name||pj.account.full_name||("Account "+slot); const synOauth={ accountUuid:pj.account.uuid, emailAddress:pj.account.email, organizationUuid:liveOrg, hasExtraUsageEnabled:pj.organization?.has_extra_usage_enabled||false, billingType:pj.organization?.billing_type||"stripe_subscription", accountCreatedAt:pj.account.created_at, subscriptionCreatedAt:pj.organization?.subscription_created_at, ccOnboardingFlags:pj.organization?.cc_onboarding_flags||{}, claudeCodeTrialEndsAt:pj.organization?.claude_code_trial_ends_at||null, claudeCodeTrialDurationDays:pj.organization?.claude_code_trial_duration_days||null, seatTier:pj.organization?.seat_tier||null, displayName:liveName, profileFetchedAt:Date.now(), organizationRole:"user", workspaceRole:null, organizationName:pj.organization?.name||"Organization", organizationType:pj.organization?.organization_type||"claude_pro", organizationRateLimitTier:pj.organization?.rate_limit_tier||"default_claude_ai", userRateLimitTier:pj.organization?.rate_limit_tier||"default_claude_ai" }; if(!curCfg.oauthAccount||curCfg.oauthAccount.accountUuid!==synOauth.accountUuid||curCfg.oauthAccount.displayName!==synOauth.displayName||curCfg.oauthAccount.organizationUuid!==liveOrg){ curCfg.oauthAccount=synOauth; _fs.writeFileSync(_cfgPath,JSON.stringify(curCfg,null,2),"utf8"); } if(liveOrg){ const freshCreds=_readJsonSafe(_credsPath); if(freshCreds&&freshCreds.organizationUuid!==liveOrg){ freshCreds.organizationUuid=liveOrg; _fs.writeFileSync(_credsPath,JSON.stringify(freshCreds,null,2),"utf8"); } } const curBkPath=slot==="1"?_acc1Path:_acc2Path; if(_fs.existsSync(curBkPath)){ const bk=_readJsonSafe(curBkPath)||{}; if(!bk.oauthAccount||bk.oauthAccount.accountUuid!==synOauth.accountUuid||bk.oauthAccount.displayName!==synOauth.displayName||bk.organizationUuid!==liveOrg){ bk.oauthAccount=synOauth; if(liveOrg)bk.organizationUuid=liveOrg; _fs.writeFileSync(curBkPath,JSON.stringify(bk,null,2),"utf8"); } } _updateAccountSwitcher(); }catch{} }); }); preq.on("error",()=>{});preq.on("timeout",()=>{try{preq.destroy();}catch{}});preq.end(); }catch{}}function _updateFromCacheRefactored(){ _updateAccountSwitcher();_updateSessionStatusBar(); const usageFile=_getUsageFile(); try{if(_fs.existsSync(usageFile)){const d=JSON.parse(_fs.readFileSync(usageFile,"utf8"));const res=_fmtU(d);if(res&&res.text){_wu.text="$(graph)Session "+res.text;}if(_usageFreshForSlot&&_usageFreshForSlot===_getActiveAccountNum()&&_peakUtil(d)>=_AUTO_THRESHOLD&&!_autoReloadFired){_triggerAutoSwap();}}}catch{}}_updateFromCacheRefactored();_fetchUsageNow();setInterval(_fetchUsageNow,120000);setInterval(_updateSessionStatusBar,3000);let _lastKnownSlot=_getActiveAccountNum();try{ _fs.watchFile(_markerPath,{interval:2000},()=>{ const newSlot=_getActiveAccountNum(); if(newSlot!==_lastKnownSlot){ _lastKnownSlot=newSlot; _usageFreshForSlot=null; _autoReloadFired=false; setTimeout(_fetchUsageNow,3000); _updateFromCacheRefactored(); } });}catch{}try{ _fs.watchFile(_credsPath,{interval:2000},()=>{ _usageFreshForSlot=null; _autoReloadFired=false; _reconcileActiveSlot(); _syncLiveTokenToActiveSlot(); setTimeout(_fetchUsageNow,1500); _updateFromCacheRefactored(); });}catch{}let _currentWatched=_getUsageFile();try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}setInterval(()=>{ const newWatched=_getUsageFile(); if(newWatched!==_currentWatched){try{_fs.unwatchFile(_currentWatched);}catch{}_currentWatched=newWatched;try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}} _updateFromCacheRefactored();},5000);const _srv=_http.createServer((req,res)=>{ try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]req:${req.method}${req.url}\\n`,"utf8");}catch{} if(req.method==="POST"&&req.url==="/usage"){ let b="";req.on("data",c=>{b+=c;}); req.on("end",()=>{ try{const parsed=JSON.parse(b);try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]POST parsed:usage=${!!parsed.usage}\\n`,"utf8");}catch{}if(parsed.usage){_fetchUsageNow();}}catch{} res.writeHead(200);res.end("ok"); }); }else{res.writeHead(404);res.end();}});_srv.on("error",(e)=>{});try{_srv.listen(54321,"127.0.0.1");}catch{}e.subscriptions.push({dispose:()=>{try{_srv.close();}catch{}try{_fs.unwatchFile(_currentWatched);}catch{}try{_fs.unwatchFile(_markerPath);}catch{}}});try{ const{spawn}=require("child_process"); const _syncPs=_path.join(_os.homedir(),".claude","projects","sync-shared.ps1"); if(_fs.existsSync(_syncPs)){ const _sc=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",_syncPs],{stdio:"ignore",windowsHide:true}); _sc.on("error",()=>{});_sc.unref(); }}catch(e){}})();';
        
        ejsContent = applyRegex(ejsContent, /(let\s+[a-zA-Z0-9_$]+\s*=\s*([a-zA-Z0-9_$]+)\.window\.createStatusBarItem\([a-zA-Z0-9_$]+\.StatusBarAlignment\.Right\);.*?)(if\([a-zA-Z0-9_$]+\.subscriptions\.push\([a-zA-Z0-9_$]+\.commands\.registerCommand\("claude-vscode\.sidebar\.open"[,)]+)/, (match, p1, vscodeVar, p2) => {
            return `${p1}${usageIIFE.replace(/Se\./g, `${vscodeVar}.`)}${p2}`;
        }, 'P8 (Status bar server & Session size monitor)');

        // P13: Hook active session state updates to live status bar
        ejsContent = applyRegex(ejsContent, /(updateSessionState\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\{this\.sessionStates\.set\(([a-zA-Z0-9_$]+),\{sessionId:[a-zA-Z0-9_$]+,state:[a-zA-Z0-9_$]+,title:([a-zA-Z0-9_$]+)\}\)),(this\.broadcastSessionStates\(\)\})/, (match, p1, sidVar, titleVar, p2) => {
            return `${p1};(globalThis.__claudeActiveSessionUpdate&&globalThis.__claudeActiveSessionUpdate(${sidVar},${titleVar}));${p2}`;
        }, 'P13 (Session state hook)');

        ejsContent = applyRegex(ejsContent, /(setActivePanel\([a-zA-Z0-9_$]+\)\{for\(let\[([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\]of this\.sessionPanels\)if\(\3===[a-zA-Z0-9_$]+\)\{this\.activeSessionId=\2),(this\.broadcastSessionStates\(\);return\}\})/, (match, p1, sidVar, panelVar, p2) => {
            return `${p1};(globalThis.__claudeActiveSessionUpdate&&globalThis.__claudeActiveSessionUpdate(${sidVar},this.sessionStates.get(${sidVar})?.title));${p2}`;
        }, 'P13_panel (Active panel hook)');
        
        // P11: Session grouping in sidebar
        let p11Found = false;
        wjsContent = wjsContent.replace(/([a-zA-Z0-9_$]+)\.map\(\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)=>\{let ([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)===([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)===([a-zA-Z0-9_$]+)\.sessionId\.value;return ([a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+,\{ref:\([a-zA-Z0-9_$]+\)=>\{if\([a-zA-Z0-9_$]+\)[a-zA-Z0-9_$]+\.current\.set\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\}.+?currentCwd:[a-zA-Z0-9_$]+\},[a-zA-Z0-9_$]+\.sessionId\.value\?\?[a-zA-Z0-9_$]+\))\}\)/g, (match, arr, sessionVar, indexVar, isFocusedVar, idxCompare1, idxCompare2, isRenamingVar, renameCompare1, renameCompare2, itemCode) => {
            p11Found = true;
            return `(()=>{let _gr={},_ug=[];${arr}.forEach((${sessionVar},${indexVar})=>{let _m=/^\\[([^\\]]+)\\]/.exec(typeof ${sessionVar}.summary==="string"?${sessionVar}.summary:${sessionVar}.summary?.value??"");if(_m)(_gr[_m[1]]=_gr[_m[1]]||[]).push({${sessionVar},${indexVar}});else _ug.push({${sessionVar},${indexVar}})});let _out=[];Object.keys(_gr).sort().forEach(_gn=>{_out.push(b("div",{key:"g_"+_gn,style:{fontWeight:"bold",padding:"4px 8px",cursor:"pointer",userSelect:"none"},onClick:(e)=>{let nx=e.currentTarget.nextSibling;nx.style.display=nx.style.display==="none"?"":"none"},children:"\\u25BE "+_gn+" ("+_gr[_gn].length+")"}));_out.push(b("div",{key:"gc_"+_gn,style:{paddingLeft:"8px"},children:_gr[_gn].map(({${sessionVar},${indexVar}})=>{let ${isFocusedVar}=${indexVar}===${idxCompare2},${isRenamingVar}=${renameCompare1}===${sessionVar}.sessionId.value;return ${itemCode}})}))});_ug.forEach(({${sessionVar},${indexVar}})=>{let ${isFocusedVar}=${indexVar}===${idxCompare2},${isRenamingVar}=${renameCompare1}===${sessionVar}.sessionId.value;_out.push(${itemCode})});return _out})()`;
        });
        if (p11Found) console.log(`      \x1b[32m✔ P11 (Session Grouping support): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P11 (Session Grouping support): Not found\x1b[0m`);

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
        else console.log(`      \x1b[31m✘ P12_ext (isShared field detection): Not found\x1b[0m`);

        // P12 (wjs): isShared signal setup
        let p12WjsA = false;
        wjsContent = wjsContent.replace(/teleportedFromSessionId=([a-zA-Z0-9_$]+)\(\(?void 0\)?\);teleportedMessageCount/g, (match, lt) => {
            p12WjsA = true;
            return `teleportedFromSessionId=${lt}(void 0);isShared=${lt}(!1);teleportedMessageCount`;
        });
        if (p12WjsA) console.log(`      \x1b[32m✔ P12_wjs_a (isShared state signal): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P12_wjs_a (isShared state signal): Not found\x1b[0m`);

        let p12WjsB = false;
        wjsContent = wjsContent.replace(/\)([a-zA-Z0-9_$]+)\.teleportedFromSessionId\.value=([a-zA-Z0-9_$]+)\.teleportedFromSessionId;if\(\2\.teleportedMessageCount/g, (match, nVar, eVar) => {
            p12WjsB = true;
            return `)${nVar}.teleportedFromSessionId.value=${eVar}.teleportedFromSessionId;if(${eVar}.isShared!==void 0)${nVar}.isShared.value=${eVar}.isShared;if(${eVar}.teleportedMessageCount`;
        });
        if (p12WjsB) console.log(`      \x1b[32m✔ P12_wjs_b (isShared server assignment): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P12_wjs_b (isShared server assignment): Not found\x1b[0m`);
        
        // P12 (wjs): italic render
        let p12WjsC = false;
        wjsContent = wjsContent.replace(/b\("span",\{className:([a-zA-Z0-9_$]+)\.sessionName,children:([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\),([a-zA-Z0-9_$]+)\)\}\)/g, (match, gn, yQe, FD, tVar, rVar) => {
            p12WjsC = true;
            return `b("span",{className:${gn}.sessionName,children:(()=>{let _t=${FD}(${tVar}),_m=/^(\\[[^\\]]+\\])(.*)/.exec(_t);if(_m&&${tVar}.isShared&&${tVar}.isShared.value)return[b("em",{key:"sh1",children:${yQe}(_m[1],${rVar})}),${yQe}(_m[2],${rVar})];return ${yQe}(_t,${rVar})})()})`;
        });
        if (p12WjsC) console.log(`      \x1b[32m✔ P12_wjs_c (isShared italic rendering): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P12_wjs_c (isShared italic rendering): Not found\x1b[0m`);
        
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
    
    console.log(`\n${BOLD}[7/7] Setting up automated session backup...${RESET}`);
    console.log(`  ${GREEN}✔ Backup script & Scheduled task preserved${RESET}`);
    
    console.log(`\n${GREEN}${BOLD}====================================================`);
    console.log(`🎉 ENHANCER INSTALLATION COMPLETED SUCCESSFULLY!`);
    console.log(`====================================================${RESET}\n`);
    
} catch (error) {
    console.error(`\n${RED}${BOLD}====================================================`);
    console.error(`❌ INSTALLATION FAILED!`);
    console.error(`====================================================${RESET}`);
    console.error(error.message);
    process.exit(1);
}
