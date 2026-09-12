$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $workspace '.reentry-dev'
foreach ($name in @('dashboard', 'api')) {
  $pidFile = Join-Path $runtime ($name + '.pid')
  if (!(Test-Path -LiteralPath $pidFile)) { continue }
  $savedPid = [int]([IO.File]::ReadAllText($pidFile).Trim())
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $savedPid" -ErrorAction SilentlyContinue
  $expected = if ($name -eq 'api') { Join-Path $workspace 'server/dist/index.js' } else { Join-Path $workspace 'node_modules/vite/bin/vite.js' }
  if ($process) {
    if (!$process.CommandLine -or !$process.CommandLine.Contains($expected)) { throw "Refusing to stop unrelated process $savedPid." }
    Stop-Process -Id $savedPid
  }
  Remove-Item -LiteralPath $pidFile -Force
}
$cluster = Join-Path $runtime 'postgres'
if (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')) {
  $postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { Split-Path (Get-Command psql.exe -ErrorAction Stop).Source }
  & (Join-Path $postgresBin 'pg_ctl.exe') -D $cluster -m fast -w stop
  if ($LASTEXITCODE -ne 0) { throw 'Unable to stop the ReEntry database. Its files have been retained.' }
}
Write-Output 'ReEntry processes stopped. All database data and configuration have been retained.'
