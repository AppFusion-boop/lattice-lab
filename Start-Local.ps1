$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$demoNode = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path -LiteralPath $demoNode)) { $demoNode = (Get-Command node -ErrorAction Stop).Source }
$demoVite = Join-Path $demoRoot 'node_modules\vite\bin\vite.js'
if (-not (Test-Path -LiteralPath $demoVite)) { throw 'Run npm install in the project folder first.' }
Set-Location -LiteralPath $demoRoot
Write-Host 'Lattice: http://127.0.0.1:5173/'
& $demoNode $demoVite --host 127.0.0.1 --port 5173 --strictPort
