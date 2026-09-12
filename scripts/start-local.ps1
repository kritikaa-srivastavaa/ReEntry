param([string]$ExtensionId = '')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $workspace '.reentry-dev'
$cluster = Join-Path $runtime 'postgres'
$serverDirectory = Join-Path $workspace 'server'
$postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { Split-Path (Get-Command psql.exe -ErrorAction Stop).Source }
$utf8 = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$configPath = Join-Path $runtime 'local-config.json'
if (!(Test-Path -LiteralPath $configPath)) {
  if (Test-Path -LiteralPath (Join-Path $serverDirectory '.env')) { throw 'server/.env already exists. Use its configured database and npm run server:dev instead; no configuration has been overwritten.' }
  $localConfig = [ordered]@{ port = 55432; adminPassword = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')); appPassword = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')); jwtSecret = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')); extensionId = '' }
  [IO.File]::WriteAllText($configPath, ($localConfig | ConvertTo-Json), $utf8)
}
$localConfig = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
if (!$ExtensionId -and !$localConfig.extensionId) {
  # Chromium GenerateIdForPath hashes the normalized Windows UTF-16 path bytes.
  # No Chrome profile/session files are read, and no manifest key is changed.
  $extensionPath = [IO.Path]::GetFullPath((Join-Path $workspace 'dist'))
  $extensionPath = $extensionPath.Substring(0, 1).ToUpperInvariant() + $extensionPath.Substring(1)
  $manifest = [IO.File]::ReadAllText((Join-Path $workspace 'public/manifest.json')) | ConvertFrom-Json
  $identityBytes = if ($manifest.key) { [Convert]::FromBase64String($manifest.key) } else { [Text.Encoding]::Unicode.GetBytes($extensionPath) }
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $identityHash = $hasher.ComputeHash($identityBytes) } finally { $hasher.Dispose() }
  $ExtensionId = -join ($identityHash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
  Write-Output "Configured expected extension ID for this checkout: $ExtensionId"
}
if ($ExtensionId) {
  if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'ExtensionId must be the 32-letter Chrome extension ID.' }
  $localConfig.extensionId = $ExtensionId
  [IO.File]::WriteAllText($configPath, ($localConfig | ConvertTo-Json), $utf8)
}
if (!(Test-Path -LiteralPath (Join-Path $cluster 'PG_VERSION'))) {
  if (Get-NetTCPConnection -LocalPort $localConfig.port -State Listen -ErrorAction SilentlyContinue) { throw 'Port 55432 is already in use. No database was initialized.' }
  $passwordFile = Join-Path $runtime 'init-password.txt'
  try {
    [IO.File]::WriteAllText($passwordFile, $localConfig.adminPassword, $utf8)
    & (Join-Path $postgresBin 'initdb.exe') -D $cluster -U reentry_admin --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to initialize ReEntry PostgreSQL.' }
  } finally { if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile -Force } }
}
& (Join-Path $postgresBin 'pg_ctl.exe') -D $cluster status *> $null
if ($LASTEXITCODE -ne 0) {
  if (Get-NetTCPConnection -LocalPort $localConfig.port -State Listen -ErrorAction SilentlyContinue) { throw 'The ReEntry database port is occupied by another process.' }
  $databaseArguments = @('-D', ('"' + $cluster + '"'), '-h', '127.0.0.1', '-p', $localConfig.port)
  $databaseProcess = Start-Process -FilePath (Join-Path $postgresBin 'postgres.exe') -ArgumentList $databaseArguments -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime 'postgres.out.log') -RedirectStandardError (Join-Path $runtime 'postgres.err.log')
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & (Join-Path $postgresBin 'pg_isready.exe') -h 127.0.0.1 -p $localConfig.port -t 1 -q
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    if ($databaseProcess.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (!$ready) { throw 'ReEntry PostgreSQL did not become ready; inspect .reentry-dev logs.' }
}
Push-Location $serverDirectory
try {
  & npm.cmd run local:configure
  if ($LASTEXITCODE -ne 0) { throw 'Database configuration failed.' }
  & npm.cmd run db:migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
} finally { Pop-Location }

function Start-ReEntryProcess([string]$name, [string]$entrypoint, [string]$workingDirectory, [int]$port, [string[]]$extraArguments = @()) {
  $pidFile = Join-Path $runtime ($name + '.pid')
  if (Test-Path -LiteralPath $pidFile) {
    $savedPid = [int]([IO.File]::ReadAllText($pidFile).Trim())
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CommandLine -and $existing.CommandLine.Contains($entrypoint)) {
      if ($name -eq 'api' -and $ExtensionId) {
        Stop-Process -Id $savedPid
        Wait-Process -Id $savedPid -Timeout 10 -ErrorAction SilentlyContinue
      } else { Write-Output "$name is already running."; return }
    }
  }
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is in use by another process; ReEntry did not replace it." }
  $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
  $arguments = @(('"' + $entrypoint + '"')) + $extraArguments
  $serviceProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $workingDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime ($name + '.out.log')) -RedirectStandardError (Join-Path $runtime ($name + '.err.log'))
  [IO.File]::WriteAllText($pidFile, [string]$serviceProcess.Id, $utf8)
}
Start-ReEntryProcess 'api' (Join-Path $serverDirectory 'dist/index.js') $serverDirectory 3001
Start-ReEntryProcess 'dashboard' (Join-Path $workspace 'node_modules/vite/bin/vite.js') $workspace 5173 @('--host', '127.0.0.1', '--port', '5173', '--strictPort')
Write-Output 'ReEntry started. Dashboard: http://localhost:5173/workspace.html. API: http://localhost:3001/api/health.'
Write-Output "Authorized extension ID: $($localConfig.extensionId). Use -ExtensionId to override if Chrome shows a different ID."
