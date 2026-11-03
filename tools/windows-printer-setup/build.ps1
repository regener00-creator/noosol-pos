param([switch]$Testing)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = Join-Path $repoRoot 'outputs/SAPURI-POS-Setup-v3.0'
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
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'วิธีการติดตั้ง.txt') -Destination $output -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ติดตั้งเครื่องพิมพ์ใบเสร็จอย่างย่อ_VOZY-G80.txt') -Destination $output -Force
if(-not $Testing){
  & (Join-Path $repoRoot 'tools/windows-print-bridge/build.ps1')
  $exePath=Join-Path $output $name
  $checksumPath=Join-Path $output 'SHA256.txt'
  ((Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash+'  '+$name) | Set-Content -LiteralPath $checksumPath -Encoding utf8
  Get-ChildItem -LiteralPath (Join-Path $output 'PrintBridge') -File | ForEach-Object { ((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash+'  PrintBridge/'+$_.Name) } | Add-Content -LiteralPath $checksumPath -Encoding utf8
  foreach($document in @('วิธีการติดตั้ง.txt','ติดตั้งเครื่องพิมพ์ใบเสร็จอย่างย่อ_VOZY-G80.txt')){
    ((Get-FileHash -LiteralPath (Join-Path $output $document) -Algorithm SHA256).Hash+'  '+$document) | Add-Content -LiteralPath $checksumPath -Encoding utf8
  }
  $zipPath=Join-Path $repoRoot 'outputs/SAPURI-POS-Setup-Windows-v3.0.zip'
  Compress-Archive -LiteralPath @($exePath,(Join-Path $output 'PrintBridge'),(Join-Path $output 'วิธีการติดตั้ง.txt'),(Join-Path $output 'ติดตั้งเครื่องพิมพ์ใบเสร็จอย่างย่อ_VOZY-G80.txt'),$checksumPath) -DestinationPath $zipPath -Force
  ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash+'  SAPURI-POS-Setup-Windows-v3.0.zip') | Set-Content -LiteralPath ($zipPath+'.sha256.txt') -Encoding ascii
  Get-Item $zipPath | Select-Object FullName,Length
}
Get-Item (Join-Path $output $name) | Select-Object FullName,Length
