$ErrorActionPreference = 'Stop'
$postgresBin = if ($env:POSTGRES_BIN) { $env:POSTGRES_BIN } else { Split-Path (Get-Command psql.exe -ErrorAction Stop).Source }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $tempRoot ('reentry-test-' + [guid]::NewGuid().ToString('N'))
$cluster = Join-Path $testRoot 'data'
$passwordFile = Join-Path $testRoot 'password.txt'
$testPassword = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$testPort = $listener.LocalEndpoint.Port
$listener.Stop()
$oldTestUrl = $env:TEST_DATABASE_URL
$started = $false
$testExit = 1
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  [IO.File]::WriteAllText($passwordFile, $testPassword, (New-Object System.Text.UTF8Encoding($false)))
  & (Join-Path $postgresBin 'initdb.exe') -D $cluster -U reentry_test --auth=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to initialize isolated PostgreSQL cluster.' }
  # Start the server directly with detached file handles, then probe readiness.
  $startArguments = @('-D', ('"' + $cluster + '"'), '-h', '127.0.0.1', '-p', $testPort)
  $postgresProcess = Start-Process -FilePath (Join-Path $postgresBin 'postgres.exe') -ArgumentList $startArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $testRoot 'postgres.out') -RedirectStandardError (Join-Path $testRoot 'postgres.log')
  $started = $true
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    & (Join-Path $postgresBin 'pg_isready.exe') -h 127.0.0.1 -p $testPort -t 1 -q
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    if ($postgresProcess.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (!$ready) { throw 'Temporary PostgreSQL did not become ready.' }
  Write-Output 'Isolated PostgreSQL is ready. Running API integration tests.'
  $env:TEST_DATABASE_URL = "postgresql://reentry_test:${testPassword}@127.0.0.1:${testPort}/postgres"
  # The test runner creates its own uniquely named database; postgres is only the maintenance connection.
  & npm.cmd test
  $testExit = $LASTEXITCODE
} finally {
  $env:TEST_DATABASE_URL = $oldTestUrl
  if ($started -and (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid'))) {
    & (Join-Path $postgresBin 'pg_ctl.exe') -D $cluster -m fast -w stop | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not stop test cluster at $cluster. It has been retained." }
  }
  if ($started -and !$postgresProcess.HasExited -and !$postgresProcess.WaitForExit(10000)) { throw "Test PostgreSQL is still running; retained $testRoot." }
  $resolvedTarget = [IO.Path]::GetFullPath($testRoot)
  if ($resolvedTarget.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTarget -Leaf) -match '^reentry-test-[a-f0-9]{32}$') {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  } else { throw 'Refusing cleanup outside the isolated test directory.' }
}
exit $testExit
