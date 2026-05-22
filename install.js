const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Colors for terminal output
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";

console.log(`${CYAN}${BOLD}====================================================`);
console.log(`        VOID CLAUDE CODE ENHANCER INSTALLER         `);
console.log(`====================================================${RESET}\n`);

try {
    const homedir = os.homedir();
    
    // ----------------------------------------------------
    // 1. Locate Claude Code Extension Folders (Void, VS Code, Cursor)
    // ----------------------------------------------------
    console.log(`${BOLD}[1/5] Detecting Claude Code extension folders...${RESET}`);
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
                // Sort and get the latest version by modified time
                dirs.sort((a, b) => {
                    return fs.statSync(path.join(app.path, b)).mtimeMs - fs.statSync(path.join(app.path, a)).mtimeMs;
                });
                
                targets.push({
                    appName: app.name,
                    extVersion: dirs[0],
                    extDir: path.join(app.path, dirs[0])
                });
            }
        }
    }
    
    if (targets.length === 0) {
        throw new Error("No anthropic.claude-code extension folder found in Void, VS Code, or Cursor extensions directories.");
    }
    
    console.log(`  ${GREEN}✔ Detected extension directories to patch:${RESET}`);
    targets.forEach(t => {
        console.log(`    - ${BOLD}${t.appName}${RESET}: ${t.extVersion}`);
    });
    
    // ----------------------------------------------------
    // 2. Read Claude Credentials & Organization ID
    // ----------------------------------------------------
    console.log(`\n${BOLD}[2/5] Extracting Claude credentials...${RESET}`);
    const credPath = path.join(homedir, '.claude', '.credentials.json');
    if (!fs.existsSync(credPath)) {
        throw new Error(`Claude credentials file not found at: ${credPath}. Please log in to Claude Code first.`);
    }
    
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const orgId = credentials.organizationUuid;
    if (!orgId) {
        throw new Error("organizationUuid not found in credentials.json.");
    }
    console.log(`  ${GREEN}✔ Successfully loaded Organization UUID: ${orgId}${RESET}`);
    
    // ----------------------------------------------------
    // 3. Configure and Deploy Edge Extension
    // ----------------------------------------------------
    console.log(`\n${BOLD}[3/5] Configuring & deploying Edge extension...${RESET}`);
    const targetEdgeDir = path.join(homedir, '.claude', 'claude-usage-extension');
    if (!fs.existsSync(targetEdgeDir)) {
        fs.mkdirSync(targetEdgeDir, { recursive: true });
    }
    
    const pkgEdgeDir = path.join(__dirname, 'edge-extension');
    const edgeManifest = fs.readFileSync(path.join(pkgEdgeDir, 'manifest.json'), 'utf8');
    const edgeBg = fs.readFileSync(path.join(pkgEdgeDir, 'background.js'), 'utf8').replace(/\{\{ORG_ID\}\}/g, orgId);
    const edgeContent = fs.readFileSync(path.join(pkgEdgeDir, 'content.js'), 'utf8').replace(/\{\{ORG_ID\}\}/g, orgId);
    
    fs.writeFileSync(path.join(targetEdgeDir, 'manifest.json'), edgeManifest, 'utf8');
    fs.writeFileSync(path.join(targetEdgeDir, 'background.js'), edgeBg, 'utf8');
    fs.writeFileSync(path.join(targetEdgeDir, 'content.js'), edgeContent, 'utf8');
    
    console.log(`  ${GREEN}✔ Configured with active Org ID and deployed to: ${targetEdgeDir}${RESET}`);
    
    // ----------------------------------------------------
    // 4. Back Up and Patch Extension Files
    // ----------------------------------------------------
    console.log(`\n${BOLD}[4/5] Patching extension code...${RESET}`);
    
    for (const target of targets) {
        const { appName, extDir, extVersion } = target;
        console.log(`\n  ${CYAN}Patching ${appName} (${extVersion})...${RESET}`);
        
        const ejs = path.join(extDir, 'extension.js');
        const wjs = path.join(extDir, 'webview', 'index.js');
        const pkg = path.join(extDir, 'package.json');
        
        // Backups suffix
        const cleanSuffix = ".bak-may21-v2.1.145-clean";
        const ejsClean = `${ejs}${cleanSuffix}`;
        const wjsClean = `${wjs}${cleanSuffix}`;
        const pkgClean = `${pkg}${cleanSuffix}`;
        
        // Save clean backups on very first run
        if (!fs.existsSync(ejsClean)) fs.copyFileSync(ejs, ejsClean);
        if (!fs.existsSync(wjsClean)) fs.copyFileSync(wjs, wjsClean);
        if (!fs.existsSync(pkgClean)) fs.copyFileSync(pkg, pkgClean);
        
        // Always restore clean copies first to avoid duplicate patches
        fs.copyFileSync(ejsClean, ejs);
        fs.copyFileSync(wjsClean, wjs);
        fs.copyFileSync(pkgClean, pkg);
        
        let ejsContent = fs.readFileSync(ejs, 'utf8');
        let wjsContent = fs.readFileSync(wjs, 'utf8');
        let pkgContent = fs.readFileSync(pkg, 'utf8');
        
        function checkSyntax(file, label) {
            try {
                if (!file.endsWith('.json')) {
                    execSync(`node -c "${file}"`, { stdio: 'ignore' });
                } else {
                    JSON.parse(fs.readFileSync(file, 'utf8'));
                }
                console.log(`      ${GREEN}✔ ${label}: Syntax OK${RESET}`);
            } catch (e) {
                console.error(`      ${RED}✘ Syntax Error encountered after applying: ${label}${RESET}`);
                process.exit(1);
            }
        }
        
        function applyEjs(oldStr, newStr, label, replaceAll = false) {
            if (!ejsContent.includes(oldStr)) {
                console.error(`      ${RED}✘ Marker not found: ${label} inside extension.js${RESET}`);
                process.exit(1);
            }
            if (replaceAll) {
                ejsContent = ejsContent.split(oldStr).join(newStr);
            } else {
                ejsContent = ejsContent.replace(oldStr, newStr);
            }
            fs.writeFileSync(ejs, ejsContent);
            checkSyntax(ejs, label);
        }
        
        function applyWjs(oldStr, newStr, label) {
            if (!wjsContent.includes(oldStr)) {
                console.error(`      ${RED}✘ Marker not found: ${label} inside webview/index.js${RESET}`);
                process.exit(1);
            }
            wjsContent = wjsContent.replace(oldStr, newStr);
            fs.writeFileSync(wjs, wjsContent);
            checkSyntax(wjs, label);
        }
        
        function applyPkg(oldStr, newStr, label) {
            if (!pkgContent.includes(oldStr)) {
                console.error(`      ${RED}✘ Marker not found: ${label} inside package.json${RESET}`);
                process.exit(1);
            }
            pkgContent = pkgContent.split(oldStr).join(newStr);
            fs.writeFileSync(pkg, pkgContent);
            checkSyntax(pkg, label);
        }
        
        // P1: package.json sidebar always visible
        applyPkg('"when": "claude-vscode.sessionsListEnabled"', '"when": "true"', 'P1 (Sidebar always visible)');
        
        // P2a/b: resolveWebviewView realpathSync bypass
        applyEjs('sj.realpathSync(x[0]||ej.homedir()).normalize("NFC")', '(x[0]||ej.homedir()).normalize("NFC")', 'P2a (Webview realpath)', true);
        applyEjs('sj.realpathSync(B[0]||ej.homedir()).normalize("NFC")', '(B[0]||ej.homedir()).normalize("NFC")', 'P2b (Panel realpath)', true);
        
        // P3: Ga() async realpath bypass
        applyEjs('async function Ga(z){try{return(await x9.realpath(z)).normalize("NFC")}catch{return z.normalize("NFC")}}', 'async function Ga(z){return z.normalize("NFC")}', 'P3 (Async realpath)');
        
        // P4: listSessions customTitles merge
        applyEjs('async listSessions(){let z=await f40({dir:this.cwd,includeWorktrees:!1}),K=await U8.readTeleportMetadata(this.cwd,z.map((B)=>B.sessionId)),V=z.map((B)=>{let Z=K.get(B.sessionId);return{id:B.sessionId,lastModified:B.lastModified,fileSize:B.fileSize,summary:B.summary,gitBranch:B.gitBranch,worktree:$b(B.cwd),isCurrentWorkspace:fg0(B.cwd,this.cwd),...Z}})', 'async listSessions(){let CT=new Map;try{CT=(await U8.load(this.cwd,this.logger)).customTitles}catch{}let z=await f40({dir:this.cwd,includeWorktrees:!1}),K=await U8.readTeleportMetadata(this.cwd,z.map((B)=>B.sessionId)),V=z.map((B)=>{let Z=K.get(B.sessionId);return{id:B.sessionId,lastModified:B.lastModified,fileSize:B.fileSize,summary:CT.get(B.sessionId)||B.summary,gitBranch:B.gitBranch,worktree:$b(B.cwd),isCurrentWorkspace:fg0(B.cwd,this.cwd),...Z}})', 'P4 (Rename list merge)');
        
        // P5a: renameSession ai-title race fix
        applyEjs('return await o1.promises.appendFile(x,JSON.stringify(O)+`\n`),this.customTitles.set(z,K),!1}', 'this.customTitles.set(z,K);return await o1.promises.appendFile(x,JSON.stringify(O)+`\n`),!1}', 'P5a (AI rename race)');
        
        // P5b: renameSession custom-title race fix
        applyEjs('return await o1.promises.appendFile(x,JSON.stringify(B)+`\n`),this.customTitles.set(z,K),!1}', 'this.customTitles.set(z,K);return await o1.promises.appendFile(x,JSON.stringify(B)+`\n`),!1}', 'P5b (Custom rename race)');
        
        // P6: 1MB head/tail buffer bump
        applyEjs('var j2=65536,', 'var j2=1048576,', 'P6a (Buffer head bump)');
        applyEjs('var _x=65536,', 'var _x=1048576,', 'P6b (Buffer tail bump)');
        
        // P7a: ja() strip mtime override
        applyEjs('async function ja(z){let K=await V_0(z.filePath);if(!K)return null;let V=Fa(z.sessionId,K,z.projectPath);if(!V)return null;if(z.mtime)V.lastModified=z.mtime;return V}', 'async function ja(z){let K=await V_0(z.filePath);if(!K)return null;let V=Fa(z.sessionId,K,z.projectPath);if(!V)return null;return V}', 'P7a (mtime override strip)');
        
        // P7b: Fa() tail-scanning timestamp IIFE
        applyEjs('lastModified:B,fileSize:Z,customTitle:L', 'lastModified:(()=>{let _ls=x.split(`\n`);for(let _i=_ls.length-1;_i>=0;_i--){let _l=_ls[_i];if((_l.includes(`"type":"user"`)||_l.includes(`"type":"assistant"`))&&!_l.includes("file-history-snapshot")&&_l.includes(`"timestamp":"`)){let _ti=_l.lastIndexOf(`"timestamp":"`);if(_ti>=0){let _tv=_l.slice(_ti+13),_te=_tv.indexOf(`"`);if(_te>=0){let _d=Date.parse(_tv.slice(0,_te));if(!isNaN(_d))return _d}}}}return B})(),fileSize:Z,customTitle:L', 'P7b (Metadata timestamp scan)');
        
        // P8: Advanced Multi-Window Usage status bar HTTP server
        const usageIIFE = '(()=>{const _http=require("http");const _fs=require("fs");const _os=require("os");const _path=require("path");const _cacheFile=_path.join(_os.homedir(),".claude","usage.json");const _wu=R0.window.createStatusBarItem(R0.StatusBarAlignment.Right,9);_wu.command="claude-vscode.openUsage";_wu.tooltip="Claude usage";_wu.text="$(graph) Claude usage";_wu.show();z.subscriptions.push(_wu);z.subscriptions.push(R0.commands.registerCommand("claude-vscode.openUsage",()=>{R0.env.openExternal(R0.Uri.parse("https://claude.ai/settings/usage"))}));function _fmtU(d){try{const p=Math.round(d.five_hour&&d.five_hour.utilization||0);const wk=Math.round(d.seven_day&&d.seven_day.utilization||0);let r="";if(d.five_hour&&d.five_hour.resets_at){const ms=new Date(d.five_hour.resets_at)-Date.now();if(ms>0){const h=Math.floor(ms/3600000);const m=Math.floor((ms%3600000)/60000);if(h>0){r=" resets in "+h+" hr "+m+" min"}else{r=" resets in "+m+" min"}}}const blocks=Math.round(p/10);const full="\\u2588".repeat(Math.min(10,blocks));const empty="\\u2591".repeat(Math.max(0,10-blocks));return full+empty+" "+p+"%"+r+" \\u2014 Weekly "+wk+"%"}catch{return"$(graph) Claude usage (err)"}}function _updateFromCache(){try{if(_fs.existsSync(_cacheFile)){const d=JSON.parse(_fs.readFileSync(_cacheFile,"utf8"));_wu.text=_fmtU(d)}}catch{}}_updateFromCache();try{_fs.watchFile(_cacheFile,{interval:2000},()=>{_updateFromCache()})}catch{}const _srv=_http.createServer((req,res)=>{if(req.method==="POST"&&req.url==="/usage"){let b="";req.on("data",c=>{b+=c});req.on("end",()=>{try{_fs.writeFileSync(_cacheFile,b,"utf8");_updateFromCache()}catch{}res.writeHead(200);res.end("ok")})}else{res.writeHead(404);res.end()}});_srv.on("error",(e)=>{});try{_srv.listen(54321,"127.0.0.1")}catch{}z.subscriptions.push({dispose:()=>{try{_srv.close()}catch{}try{_fs.unwatchFile(_cacheFile)}catch{}}})})();';
        applyEjs('&&G)w.show();if(z.subscriptions.push(R0.commands.registerCommand("claude-vscode.sidebar.open"', '&&G)w.show();' + usageIIFE + 'if(z.subscriptions.push(R0.commands.registerCommand("claude-vscode.sidebar.open"', 'P8 (Advanced status bar server)');
        
        // P12 (ext): isShared symlink check
        applyEjs('isCurrentWorkspace:fg0(B.cwd,this.cwd),...Z}})', 'isCurrentWorkspace:fg0(B.cwd,this.cwd),isShared:(()=>{try{return o1.lstatSync(u1.join(r7(this.cwd),B.sessionId+".jsonl")).isSymbolicLink()}catch{return!1}})(),...Z}})', 'P12_ext (isShared field detection)');
        
        // P9: webview doListSessions summary clobber fix
        applyWjs('if(z.sessionId.value=G.id,z.lastModifiedTime.value=G.lastModified,G.summary)z.summary.value=G.summary;continue', 'z.sessionId.value=G.id;z.lastModifiedTime.value=G.lastModified;continue', 'P9 (Webview summary overwrite fix)');
        
        // P10: webview state update title clobber fix
        applyWjs('if(N.busy.value=O.state!=="idle",N.pendingInput.value=O.state==="waiting_input",O.title)N.summary.value=O.title', 'N.busy.value=O.state!=="idle";N.pendingInput.value=O.state==="waiting_input"', 'P10 (Webview title overwrite fix)');
        
        // P11: webview session grouping by [GroupName]
        const itemCode = 'S0.default.createElement(OR0,{key:g1.sessionId.value??o1,ref:(W5)=>{if(W5)$1.current.set(o1,W5)},session:g1,isActive:g1===q,isFocused:h5,isRenaming:k2,searchQuery:y,onClick:()=>z(g1),onMouseMove:()=>{O(o1),E(null)},onStartRename:_==="local"&&U?s:void 0,onFinishRename:K1,onCancelRename:H1,onDelete:_==="local"&&V?V:void 0,onOpenInNewWindow:_==="local"&&H?H:void 0,currentCwd:B})';
        const groupIIFE = '(()=>{let _gr={},_ug=[];b.forEach((g1,o1)=>{let _m=/^\\\[([^\\\]]+)\\\]/.exec(Kk(g1));if(_m)(_gr[_m[1]]=_gr[_m[1]]||[]).push({g1,o1});else _ug.push({g1,o1})});let _out=[];Object.keys(_gr).sort().forEach(_gn=>{_out.push(S0.default.createElement("div",{key:"g_"+_gn,style:{fontWeight:"bold",padding:"4px 8px",cursor:"pointer",userSelect:"none"},onClick:(e)=>{let nx=e.currentTarget.nextSibling;nx.style.display=nx.style.display==="none"?"":"none"}},"\\u25BE "+_gn));_out.push(S0.default.createElement("div",{key:"gc_"+_gn,style:{paddingLeft:"8px"}},_gr[_gn].map(({g1,o1})=>{let h5=o1===w,k2=p===g1.sessionId.value;return ' + itemCode + '})))});_ug.forEach(({g1,o1})=>{let h5=o1===w,k2=p===g1.sessionId.value;_out.push(' + itemCode + ')});return _out})()';
        applyWjs('b.map((g1,o1)=>{let h5=o1===w,k2=p===g1.sessionId.value;return ' + itemCode + '})', groupIIFE, 'P11 (Session Grouping support)');
        
        // P12 (wjs): isShared signal setup
        applyWjs('teleportedFromSessionId=O0(void 0);teleportedMessageCount', 'teleportedFromSessionId=O0(void 0);isShared=O0(!1);teleportedMessageCount', 'P12_wjs_a (isShared state signal)');
        applyWjs(')Y.teleportedFromSessionId.value=$.teleportedFromSessionId;if($.teleportedMessageCount', ')Y.teleportedFromSessionId.value=$.teleportedFromSessionId;if($.isShared!==void 0)Y.isShared.value=$.isShared;if($.teleportedMessageCount', 'P12_wjs_b (isShared server assignment)');
        
        // P12 (wjs): italic render
        applyWjs('S0.default.createElement("span",{className:w2.sessionName},Le1(Kk(Z),Q))', 'S0.default.createElement("span",{className:w2.sessionName},(()=>{let _t=Kk(Z),_m=/^(\\[[^\\]]+\\])(.*)/.exec(_t);if(_m&&Z.isShared&&Z.isShared.value)return S0.default.createElement(S0.default.Fragment,null,S0.default.createElement("em",null,Le1(_m[1],Q)),Le1(_m[2],Q));return Le1(_t,Q)})())', 'P12_wjs_c (isShared italic rendering)');
        
        // Save backup copies of fully patched files
        const safeBackupDir = path.join(homedir, '.claude', 'void-patches', 'v2.1.145');
        if (!fs.existsSync(safeBackupDir)) {
            fs.mkdirSync(safeBackupDir, { recursive: true });
        }
        const nameSlug = appName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        fs.copyFileSync(ejs, path.join(safeBackupDir, `extension-${nameSlug}.js`));
        fs.copyFileSync(wjs, path.join(safeBackupDir, `webview-index-${nameSlug}.js`));
        fs.copyFileSync(pkg, path.join(safeBackupDir, `package-${nameSlug}.json`));
        
        console.log(`    ${GREEN}✔ ${appName} patched successfully and backed up in: ${safeBackupDir}${RESET}`);
    }
    
    console.log(`\n  ${GREEN}✔ All files patched successfully!${RESET}`);
    
    // ----------------------------------------------------
    // 5. Silent Startup Automation Setup
    // ----------------------------------------------------
    console.log(`\n${BOLD}[5/5] Registering silent Windows Startup script...${RESET}`);
    const patchesDir = path.join(homedir, '.claude', 'void-patches');
    if (!fs.existsSync(patchesDir)) {
        fs.mkdirSync(patchesDir, { recursive: true });
    }
    
    const batPath = path.join(patchesDir, 'startup-usage-refresh.bat');
    const vbsPath = path.join(patchesDir, 'startup-usage-refresh.vbs');
    
    // Write BAT
    fs.writeFileSync(batPath, `@echo off\nstart "" /min msedge.exe --minimized "https://claude.ai"\ntimeout /t 8 /nobreak >nul\ntaskkill /f /im msedge.exe\n`, 'utf8');
    
    // Write VBS
    fs.writeFileSync(vbsPath, `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${batPath.replace(/\\/g, '\\\\')}", 0, True\n`, 'utf8');
    
    // Register Windows Startup Shortcut via PowerShell
    const startupLnkPath = path.join(homedir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'ClaudeUsageStartup.lnk');
    const psCommand = `$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('${startupLnkPath.replace(/'/g, "''")}'); $Shortcut.TargetPath = 'wscript.exe'; $Shortcut.Arguments = '"${vbsPath.replace(/'/g, "''")}"'; $Shortcut.IconLocation = 'msedge.exe, 0'; $Shortcut.Save();`;
    
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'ignore' });
    console.log(`  ${GREEN}✔ Windows startup shortcut placed at: ${startupLnkPath}${RESET}`);
    
    // ----------------------------------------------------
    // FINISHED SUCCESS
    // ----------------------------------------------------
    console.log(`\n${GREEN}${BOLD}====================================================`);
    console.log(`🎉 ENHANCER INSTALLATION COMPLETED SUCCESSFULLY!`);
    console.log(`====================================================${RESET}\n`);
    console.log(`To apply all changes:`);
    console.log(`  1. ${BOLD}Restart Void fully${RESET} (Close the application entirely, then reopen it).`);
    console.log(`  2. ${BOLD}Reload the Edge Extension${RESET} in edge://extensions (Click ↺ Reload).`);
    console.log(`  3. The status bar will now instantly auto-refresh completely in the background!\n`);
    
} catch (error) {
    console.error(`\n${RED}${BOLD}====================================================`);
    console.error(`❌ INSTALLATION FAILED!`);
    console.error(`====================================================${RESET}`);
    console.error(error.message);
    process.exit(1);
}
