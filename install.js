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
        

        // P8: Advanced Multi-Window Usage status bar HTTP server
        const usageIIFE = '(()=>{const _http=require("http");const _https=require("https");const _fs=require("fs");const _os=require("os");const _path=require("path");const _credsPath=_path.join(_os.homedir(),".claude",".credentials.json");const _markerPath=_path.join(_os.homedir(),".claude",".active_account");const _cfgPath=_path.join(_os.homedir(),".claude.json");function _readJsonSafe(p){try{return JSON.parse(_fs.readFileSync(p,"utf8"));}catch{return null;}}function _getActiveOrgId(){try{const creds=JSON.parse(_fs.readFileSync(_credsPath,"utf8"));return creds.organizationUuid;}catch{return undefined;}}function _getActiveAccountNum(){try{const n=_fs.readFileSync(_markerPath,"utf8").trim();if(n==="1"||n==="2")return n;}catch{}return null;}function _getUsageFile(){const accNum=_getActiveAccountNum();if(accNum==="1")return _path.join(_os.homedir(),".claude","usage_account1.json");if(accNum==="2")return _path.join(_os.homedir(),".claude","usage_account2.json");return _path.join(_os.homedir(),".claude","usage.json");}const _wu=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,9);_wu.command="claude-vscode.openUsage";_wu.tooltip="Claude usage";_wu.text="$(graph)Claude usage";_wu.show();e.subscriptions.push(_wu);e.subscriptions.push(Se.commands.registerCommand("claude-vscode.openUsage",()=>{Se.env.openExternal(Se.Uri.parse("https://claude.ai/settings/usage"));}));const _wa=Se.window.createStatusBarItem(Se.StatusBarAlignment.Right,10);_wa.command="claude-vscode.swapAccount";_wa.tooltip="Swap Claude Account";_wa.text="$(account)Account Switcher";_wa.show();e.subscriptions.push(_wa);const _acc1Path=_path.join(_os.homedir(),".claude",".credentials_account1.json");const _acc2Path=_path.join(_os.homedir(),".claude",".credentials_account2.json");function _getAccountInfo(){const accNum=_getActiveAccountNum();if(accNum==="1")return{currentAcc:"Account 1",otherAccPath:_acc2Path,otherAccNum:"2"};if(accNum==="2")return{currentAcc:"Account 2",otherAccPath:_acc1Path,otherAccNum:"1"};return{currentAcc:"Unknown",otherAccPath:null,otherAccNum:null};}function _updateAccountSwitcher(){const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo();function _cd(ts){if(!ts)return "";const d=ts-Date.now();if(d<=0)return "(Expired!)";const days=Math.floor(d/86400000);if(days>0)return "("+days+"d)";return "("+Math.floor(d/3600000)+"h)";}const live=_readJsonSafe(_credsPath);const countdown=live&&live.claudeAiOauth?_cd(live.claudeAiOauth.refreshTokenExpiresAt):"";const cfg=_readJsonSafe(_cfgPath);const curName=cfg&&cfg.oauthAccount&&cfg.oauthAccount.displayName?cfg.oauthAccount.displayName:"";let label=currentAcc==="Unknown"?"Account ?":currentAcc;if(curName)label=label+": "+curName;_wa.text="$(account) "+label+(countdown?" "+countdown:"");const oth=otherAccPath?_readJsonSafe(otherAccPath):null;const othName=oth&&oth.oauthAccount&&oth.oauthAccount.displayName?" ("+oth.oauthAccount.displayName+")":"";const othCd=oth&&oth.claudeAiOauth?_cd(oth.claudeAiOauth.refreshTokenExpiresAt):"";_wa.tooltip=otherAccNum?("Signed in as "+label+" "+countdown+" - click to switch to Account "+otherAccNum+othName+" "+othCd):"Swap Claude Account";}function _swapAccounts(silent=false){const{currentAcc,otherAccPath,otherAccNum}=_getAccountInfo();if(!otherAccPath||!_fs.existsSync(otherAccPath)){if(!silent)Se.window.showErrorMessage("Cannot swap:Backup for account "+otherAccNum+" not found at "+otherAccPath);return;}try{const currentCreds=JSON.parse(_fs.readFileSync(_credsPath,"utf8"));const currentCfg=_readJsonSafe(_cfgPath);const currentBackupPath=currentAcc==="Account 1"?_acc1Path:_acc2Path;if(currentAcc!=="Unknown"){const bk={claudeAiOauth:currentCreds.claudeAiOauth};if(currentCreds.organizationUuid)bk.organizationUuid=currentCreds.organizationUuid;if(currentCfg&&currentCfg.oauthAccount)bk.oauthAccount=currentCfg.oauthAccount;_fs.writeFileSync(currentBackupPath,JSON.stringify(bk,null,2),"utf8");}const otherCreds=_readJsonSafe(otherAccPath);if(!otherCreds||!otherCreds.claudeAiOauth){if(!silent)Se.window.showErrorMessage("Swap aborted: backup for account "+otherAccNum+" has no claudeAiOauth token.");return;}currentCreds.claudeAiOauth=otherCreds.claudeAiOauth;if(otherCreds.organizationUuid)currentCreds.organizationUuid=otherCreds.organizationUuid;else delete currentCreds.organizationUuid;_fs.writeFileSync(_credsPath,JSON.stringify(currentCreds,null,2),"utf8");if(currentCfg){try{_fs.writeFileSync(_cfgPath+".bak-swap-"+Date.now(),JSON.stringify(currentCfg,null,2),"utf8");}catch{}if(otherCreds.oauthAccount)currentCfg.oauthAccount=otherCreds.oauthAccount;else delete currentCfg.oauthAccount;_fs.writeFileSync(_cfgPath,JSON.stringify(currentCfg,null,2),"utf8");}if(!silent&&(!otherCreds.organizationUuid||!otherCreds.oauthAccount)){Se.window.showWarningMessage("Account "+otherAccNum+" backup has no cached org identity. Claude will re-derive it from the token on load; swap away and back once to capture it.");}_fs.writeFileSync(_markerPath,otherAccNum,"utf8");if(silent)return true;Se.commands.executeCommand("workbench.action.reloadWindow");}catch(err){if(!silent)Se.window.showErrorMessage("Swap failed:"+err.message);}}e.subscriptions.push(Se.commands.registerCommand("claude-vscode.swapAccount",()=>{_swapAccounts(false);}));function _fmtU(d){try{const p=Math.round(d.five_hour&&d.five_hour.utilization||0);const wk=Math.round(d.seven_day&&d.seven_day.utilization||0);let r="";if(d.five_hour&&d.five_hour.resets_at){const ms=new Date(d.five_hour.resets_at)-Date.now();if(ms>0){const h=Math.floor(ms / 3600000);const m=Math.floor((ms % 3600000)/ 60000);if(h>0){r=" resets in "+h+" hr "+m+" min";}else{r=" resets in "+m+" min";}}}const blocks=Math.round(p / 10);const full="\u2588".repeat(Math.min(10,blocks));const empty="\u2591".repeat(Math.max(0,10-blocks));return{text:full+empty+" "+p+"%"+r+" \u2014 Weekly "+wk+"%",util:p};}catch{return{text:"$(graph)Claude usage(err)",util:0};}}const _autoStatePath=_path.join(_os.homedir(),".claude",".autoswap_state.json");const _AUTO_THRESHOLD=95;const _AUTO_COOLDOWN_MS=1800000;let _usageFresh=false;function _peakUtil(d){try{const a=Math.round((d&&d.five_hour&&d.five_hour.utilization)||0);const b=Math.round((d&&d.seven_day&&d.seven_day.utilization)||0);return Math.max(a,b);}catch{return 0;}}function _otherHasHeadroom(n){try{const f=_path.join(_os.homedir(),".claude","usage_account"+n+".json");if(!_fs.existsSync(f))return true;return _peakUtil(_readJsonSafe(f))<_AUTO_THRESHOLD;}catch{return true;}}function _autoSwapAllowed(){try{const st=_readJsonSafe(_autoStatePath);if(st&&st.lastSwapAt&&(Date.now()-st.lastSwapAt)<_AUTO_COOLDOWN_MS)return false;}catch{}return true;}function _noteAutoSwap(){try{_fs.writeFileSync(_autoStatePath,JSON.stringify({lastSwapAt:Date.now()}),"utf8");}catch{}}let _autoReloadTimer=null;let _autoReloadFired=false;function _triggerAutoSwap(){const info=_getAccountInfo();if(!info.otherAccNum)return;if(!_autoSwapAllowed()){_autoReloadFired=true;return;}if(!_otherHasHeadroom(info.otherAccNum)){_autoReloadFired=true;Se.window.showWarningMessage("Claude quota reached, but Account "+info.otherAccNum+" is also at its limit - staying put.");return;}const swapped=_swapAccounts(true);if(swapped){_noteAutoSwap();_autoReloadFired=true;_autoReloadTimer=setTimeout(()=>{Se.commands.executeCommand("workbench.action.reloadWindow");},5000);Se.window.showWarningMessage("Claude quota reached - swapped to Account "+info.otherAccNum+". Reloading in 5s...","Cancel Reload","Reload Now").then(sel=>{if(sel==="Cancel Reload"){try{clearTimeout(_autoReloadTimer);}catch{}_swapAccounts(true);_updateAccountSwitcher();}else if(sel==="Reload Now"){try{clearTimeout(_autoReloadTimer);}catch{}Se.commands.executeCommand("workbench.action.reloadWindow");}});}}function _fetchUsageNow(){try{const c=_readJsonSafe(_credsPath);if(!c||!c.claudeAiOauth||!c.claudeAiOauth.accessToken)return;const slot=_getActiveAccountNum();const target=_getUsageFile();const req=_https.request("https://api.anthropic.com/api/oauth/usage",{method:"GET",headers:{"Authorization":"Bearer "+c.claudeAiOauth.accessToken,"anthropic-beta":"oauth-2025-04-20","Content-Type":"application/json"},timeout:15000},(r)=>{let b="";r.on("data",(d)=>{b+=d;});r.on("end",()=>{try{if(r.statusCode!==200)return;const u=JSON.parse(b);if(!u||!u.five_hour)return;if(_getActiveAccountNum()!==slot)return;_fs.writeFileSync(target,JSON.stringify(u),"utf8");_usageFresh=true;_updateFromCacheRefactored();}catch{}});});req.on("error",()=>{});req.on("timeout",()=>{try{req.destroy();}catch{}});req.end();}catch{}}function _updateFromCacheRefactored(){_updateAccountSwitcher();const usageFile=_getUsageFile();try{if(_fs.existsSync(usageFile)){const d=JSON.parse(_fs.readFileSync(usageFile,"utf8"));const res=_fmtU(d);if(res&&res.text){_wu.text="$(graph)Session "+res.text;}if(_usageFresh&&_peakUtil(d)>=_AUTO_THRESHOLD&&!_autoReloadFired){_triggerAutoSwap();}}}catch{}}_updateFromCacheRefactored();_fetchUsageNow();setInterval(_fetchUsageNow,120000);let _currentWatched=_getUsageFile();try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}setInterval(()=>{const newWatched=_getUsageFile();if(newWatched!==_currentWatched){try{_fs.unwatchFile(_currentWatched);}catch{}_currentWatched=newWatched;try{if(_fs.existsSync(_currentWatched)){_fs.watchFile(_currentWatched,{interval:2000},_updateFromCacheRefactored);}}catch{}}_updateFromCacheRefactored();},5000);const _srv=_http.createServer((req,res)=>{try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]req:${req.method}${req.url}\n`,"utf8");}catch{}if(req.method==="POST"&&req.url==="/usage"){let b="";req.on("data",c=>{b+=c;});req.on("end",()=>{try{const parsed=JSON.parse(b);try{_fs.appendFileSync(_path.join(_os.homedir(),".claude","usage-debug.log"),`[${new Date().toISOString()}]POST parsed:usage=${!!parsed.usage}\n`,"utf8");}catch{}if(parsed.usage){_fetchUsageNow();}}catch{}res.writeHead(200);res.end("ok");});}else{res.writeHead(404);res.end();}});_srv.on("error",(e)=>{});try{_srv.listen(54321,"127.0.0.1");}catch{}e.subscriptions.push({dispose:()=>{try{_srv.close();}catch{}try{_fs.unwatchFile(_currentWatched);}catch{}}});try{const{spawn}=require("child_process");spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File","C:\\\\\\\\Users\\\\\\\\SEO\\\\\\\\.claude\\\\\\\\projects\\\\\\\\sync-shared.ps1"],{detached:true,stdio:"ignore"}).unref()}catch(e){}})();';
        
        ejsContent = applyRegex(ejsContent, /(let\s+[a-zA-Z0-9_$]+\s*=\s*([a-zA-Z0-9_$]+)\.window\.createStatusBarItem\([a-zA-Z0-9_$]+\.StatusBarAlignment\.Right\);.*?)(if\([a-zA-Z0-9_$]+\.subscriptions\.push\([a-zA-Z0-9_$]+\.commands\.registerCommand\("claude-vscode\.sidebar\.open"[,)]+)/, (match, p1, vscodeVar, p2) => {
            return `${p1}${usageIIFE.replace(/Se\./g, `${vscodeVar}.`)}${p2}`;
        }, 'P8 (Status bar server)');

        
        // P11: Session grouping in sidebar
        let p11Found = false;
        wjsContent = wjsContent.replace(/([a-zA-Z0-9_$]+)\.map\(\(([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)\)=>\{let ([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)===([a-zA-Z0-9_$]+),([a-zA-Z0-9_$]+)=([a-zA-Z0-9_$]+)===([a-zA-Z0-9_$]+)\.sessionId\.value;return ([a-zA-Z0-9_$]+\([a-zA-Z0-9_$]+,\{ref:\([a-zA-Z0-9_$]+\)=>\{if\([a-zA-Z0-9_$]+\)[a-zA-Z0-9_$]+\.current\.set\([a-zA-Z0-9_$]+,[a-zA-Z0-9_$]+\)\}.+?currentCwd:[a-zA-Z0-9_$]+\},[a-zA-Z0-9_$]+\.sessionId\.value\?\?[a-zA-Z0-9_$]+\))\}\)/g, (match, arr, sessionVar, indexVar, isFocusedVar, idxCompare1, idxCompare2, isRenamingVar, renameCompare1, renameCompare2, itemCode) => {
            p11Found = true;
            return `(()=>{let _gr={},_ug=[];${arr}.forEach((${sessionVar},${indexVar})=>{let _m=/^\\[([^\\]]+)\\]/.exec(typeof ${sessionVar}.summary==="string"?${sessionVar}.summary:${sessionVar}.summary?.value??"");if(_m)(_gr[_m[1]]=_gr[_m[1]]||[]).push({${sessionVar},${indexVar}});else _ug.push({${sessionVar},${indexVar}})});let _out=[];Object.keys(_gr).sort().forEach(_gn=>{_out.push(b("div",{key:"g_"+_gn,style:{fontWeight:"bold",padding:"4px 8px",cursor:"pointer",userSelect:"none"},onClick:(e)=>{let nx=e.currentTarget.nextSibling;nx.style.display=nx.style.display==="none"?"":"none"},children:"\\u25BE "+_gn+" ("+_gr[_gn].length+")"}));_out.push(b("div",{key:"gc_"+_gn,style:{paddingLeft:"8px"},children:_gr[_gn].map(({${sessionVar},${indexVar}})=>{let ${isFocusedVar}=${indexVar}===${idxCompare2},${isRenamingVar}=${renameCompare1}===${sessionVar}.sessionId.value;return ${itemCode}})}))});_ug.forEach(({${sessionVar},${indexVar}})=>{let ${isFocusedVar}=${indexVar}===${idxCompare2},${isRenamingVar}=${renameCompare1}===${sessionVar}.sessionId.value;_out.push(${itemCode})});return _out})()`;
        });
        if (p11Found) console.log(`      \x1b[32m✔ P11 (Session Grouping support): Applied\x1b[0m`);
        else console.log(`      \x1b[31m✘ P11 (Session Grouping support): Not found\x1b[0m`);

        // P12 (ext): isShared symlink check
        let p12ExtFound = false;
        ejsContent = ejsContent.replace(/isCurrentWorkspace:([a-zA-Z0-9_$]+)\(([a-zA-Z0-9_$]+)\.cwd,this\.cwd\),\.\.\.([a-zA-Z0-9_$]+)\}\}\)/g, (match, rQe, oVar, sVar) => {
            p12ExtFound = true;
            return `isCurrentWorkspace:${rQe}(${oVar}.cwd,this.cwd),isShared:(()=>{try{return require("fs").lstatSync(require("path").join(EWe(${oVar}.cwd),${oVar}.sessionId+".jsonl")).isSymbolicLink()}catch{return!1}})(),...${sVar}}})`;
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
