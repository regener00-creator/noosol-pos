param([switch]$Testing)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = Join-Path $repoRoot 'outputs/SAPURI-POS-Setup'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$iconPath = Join-Path $output 'sapuri.ico'
& (Join-Path $PSScriptRoot 'build-icon.ps1') -Source (Join-Path $repoRoot 'sapuri-app-icon-512.png') -Destination $iconPath
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$name = if($Testing){'SAPURI-POS-Setup-Test.exe'}else{'SAPURI-POS-Setup.exe'}
$argsList = @('/nologo','/target:winexe','/platform:anycpu','/optimize+','/utf8output','/codepage:65001',('/out:'+(Join-Path $output $name)),('/win32icon:'+$iconPath),('/win32manifest:'+(Join-Path $PSScriptRoot 'app.manifest')),('/resource:'+$iconPath+',sapuri.ico'),'/r:System.dll','/r:System.Core.dll','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Management.dll','/r:System.Web.Extensions.dll','/r:Microsoft.CSharp.dll',(Join-Path $PSScriptRoot 'Setup.cs'))
if($Testing){$argsList+=@('/define:SETUP_TESTING',(Join-Path $PSScriptRoot 'Tests.cs'))}
$argsList+=(Join-Path $PSScriptRoot 'ShellIdentity.cs')
& $compiler @argsList
if($LASTEXITCODE -ne 0){throw 'Compilation failed'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README-th.txt') -Destination $output -Force
if(-not $Testing){
  $exePath=Join-Path $output $name
  $checksumPath=Join-Path $output 'SHA256.txt'
  ((Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash+'  '+$name) | Set-Content -LiteralPath $checksumPath -Encoding ascii
  $zipPath=Join-Path $repoRoot 'outputs/SAPURI-POS-Setup-Windows-v2.zip'
  Compress-Archive -LiteralPath @($exePath,(Join-Path $output 'README-th.txt'),$checksumPath) -DestinationPath $zipPath -Force
  ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash+'  SAPURI-POS-Setup-Windows-v2.zip') | Set-Content -LiteralPath ($zipPath+'.sha256.txt') -Encoding ascii
  Get-Item $zipPath | Select-Object FullName,Length
}
Get-Item (Join-Path $output $name) | Select-Object FullName,Length
