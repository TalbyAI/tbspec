param([string]$Path)
$ErrorActionPreference = 'Stop'
$stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
[Console]::WriteLine('holding')
[Console]::Out.Flush()
[Console]::ReadLine() | Out-Null
$stream.Dispose()
