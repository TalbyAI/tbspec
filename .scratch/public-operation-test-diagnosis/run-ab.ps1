$ErrorActionPreference = 'Stop'
$diagnosticDirectory = Split-Path -Parent $PSCommandPath
$env:NODE_OPTIONS = ''
$diagnosticResults = @()
$diagnosticSequence = @('control', 'direct-setup', 'direct-setup', 'control', 'control', 'direct-setup')
foreach ($diagnosticIndex in 0..5) {
  $diagnosticMode = $diagnosticSequence[$diagnosticIndex]
  $diagnosticLog = Join-Path $diagnosticDirectory "ab-$diagnosticIndex-$diagnosticMode.tap"
  $diagnosticArguments = @('--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=^CLI validates, lists shapes and confirms schema removal offline with exact signatures$', 'tests/cli.test.ts')
  if ($diagnosticMode -eq 'direct-setup') {
    $diagnosticHook = ([uri](Join-Path $diagnosticDirectory 'fixture-setup.mjs')).AbsoluteUri
    $diagnosticArguments = @("--import=$diagnosticHook") + $diagnosticArguments
  }
  $diagnosticTimer = [Diagnostics.Stopwatch]::StartNew()
  & node @diagnosticArguments *> $diagnosticLog
  $diagnosticExit = $LASTEXITCODE
  $diagnosticTimer.Stop()
  $diagnosticTap = Get-Content -Raw -LiteralPath $diagnosticLog
  $diagnosticMatch = [regex]::Match($diagnosticTap, 'duration_ms: ([\d.]+)')
  if ($diagnosticExit -ne 0 -or -not $diagnosticMatch.Success) { throw "A/B probe failed: $diagnosticLog" }
  $diagnosticRow = [pscustomobject]@{ index=$diagnosticIndex; mode=$diagnosticMode; exitCode=$diagnosticExit; testSeconds=([double]::Parse($diagnosticMatch.Groups[1].Value, [cultureinfo]::InvariantCulture) / 1000); wallSeconds=$diagnosticTimer.Elapsed.TotalSeconds }
  $diagnosticResults += $diagnosticRow
  ConvertTo-Json -InputObject $diagnosticResults | Set-Content -LiteralPath (Join-Path $diagnosticDirectory 'ab-results.json')
  $diagnosticRow | ConvertTo-Json -Compress | Write-Output
}
