# Shared-session sync.
#
# 1. Any session whose custom title starts with [s] is moved into projects\General\,
#    the [s] prefix is stripped, and a symlink is placed in every project folder so
#    the session appears in all workspaces.
# 2. Any session already in General\ that is missing a link somewhere gets one.
#
# Symlink creation needs either an elevated shell or Windows Developer Mode.
# Earlier revisions piped mklink to Out-Null and printed success unconditionally,
# so failures were invisible and folders silently went unlinked. Every link is now
# verified after creation and failures are surfaced with a total at the end.

$projectsDir = "C:\Users\SEO\.claude\projects"
$generalDir  = "$projectsDir\General"
$skip = @("General", "backup")

if (!(Test-Path $generalDir)) { New-Item -ItemType Directory -Path $generalDir | Out-Null }
$projectFolders = Get-ChildItem $projectsDir -Directory |
    Where-Object { $skip -notcontains $_.Name } |
    Select-Object -ExpandProperty FullName

$script:created = 0
$script:failed  = 0

function New-SharedLink {
    param(
        [Parameter(Mandatory)][string]$LinkPath,
        [Parameter(Mandatory)][string]$TargetPath,
        [switch]$Junction
    )
    if (Test-Path $LinkPath) { return }
    $kind = if ($Junction) { "junction" } else { "symlink" }
    $flag = if ($Junction) { "/J " } else { "" }
    $out = cmd /c "mklink $flag`"$LinkPath`" `"$TargetPath`"" 2>&1
    # mklink can report success and still not produce the link, so verify on disk
    if ($LASTEXITCODE -ne 0 -or !(Test-Path $LinkPath)) {
        $script:failed++
        Write-Host "  [FAIL] $kind -> $(Split-Path $LinkPath -Leaf) in $(Split-Path (Split-Path $LinkPath -Parent) -Leaf)" -ForegroundColor Red
        Write-Host "         mklink: $out" -ForegroundColor DarkGray
        return
    }
    $script:created++
    Write-Host "  [ok]   $kind -> $(Split-Path (Split-Path $LinkPath -Parent) -Leaf)" -ForegroundColor Green
}

# ----------------------------------------------------
# 1. Promote [s]-tagged sessions into General
# ----------------------------------------------------
$found = 0
foreach ($folder in $projectFolders) {
    Get-ChildItem "$folder\*.jsonl" -ErrorAction SilentlyContinue |
        Where-Object { !$_.Attributes.ToString().Contains("ReparsePoint") } |
        ForEach-Object {
            $file = $_
            $lines = Get-Content $file.FullName -Encoding UTF8 -ErrorAction SilentlyContinue
            $titleLine = $lines | Where-Object { $_ -match '"type":"custom-title"' } | Select-Object -Last 1
            if (!$titleLine) { return }
            if ($titleLine -notmatch '"customTitle":"\[s\]') { return }
            if ($titleLine -match '"customTitle":"(\[s\].+?)"') {
                $oldTitle = $matches[1]
                $newTitle = $oldTitle -replace '^\[s\]', ''
            } else { return }

            Write-Host "Processing: $($file.Name) - '$oldTitle' -> '$newTitle'"
            $found++
            $dest = "$generalDir\$($file.Name)"

            Move-Item $file.FullName $dest -Force

            $subSrc  = Join-Path $folder $file.BaseName
            $subDest = Join-Path $generalDir $file.BaseName
            if ((Test-Path $subSrc) -and !(Test-Path $subDest)) { Move-Item $subSrc $subDest -Force }

            $record = '{"type":"custom-title","sessionId":"' + $file.BaseName + '","customTitle":"' + $newTitle + '"}'
            Add-Content -Path $dest -Value $record -Encoding UTF8

            foreach ($pf in $projectFolders) {
                New-SharedLink -LinkPath "$pf\$($file.Name)" -TargetPath $dest
                if (Test-Path $subDest) {
                    New-SharedLink -LinkPath (Join-Path $pf $file.BaseName) -TargetPath $subDest -Junction
                }
            }
        }
}
if ($found -eq 0) { Write-Host "No new [s]-prefixed sessions to process." }
else { Write-Host "Done - $found new session(s) processed." }

# ----------------------------------------------------
# 2. Backfill links for sessions already in General
# ----------------------------------------------------
Write-Host "`nSyncing existing shared sessions from General..."
foreach ($file in (Get-ChildItem "$generalDir\*.jsonl" -Force -ErrorAction SilentlyContinue)) {
    $subDest = Join-Path $generalDir $file.BaseName
    foreach ($pf in $projectFolders) {
        New-SharedLink -LinkPath "$pf\$($file.Name)" -TargetPath $file.FullName
        if (Test-Path $subDest) {
            New-SharedLink -LinkPath (Join-Path $pf $file.BaseName) -TargetPath $subDest -Junction
        }
    }
}

Write-Host ""
if ($script:failed -gt 0) {
    Write-Host "Shared session sync finished with $($script:failed) FAILURE(S); $($script:created) link(s) created." -ForegroundColor Red
    Write-Host "Symlinks need an elevated shell or Windows Developer Mode (Settings > System > For developers)." -ForegroundColor Yellow
    exit 1
}
Write-Host "Shared session sync complete - $($script:created) link(s) created, 0 failures." -ForegroundColor Green
