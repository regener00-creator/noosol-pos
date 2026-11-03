param([switch]$Testing)
$ErrorActionPreference='Stop'
$repo=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cache=Join-Path $repo 'outputs/print-deps'
$output=Join-Path $repo $(if($Testing){'outputs/SAPURI-Print-Test'}else{'outputs/SAPURI-POS-Setup-v3.0/PrintBridge'})
New-Item -ItemType Directory -Force $cache,$output | Out-Null
function Fetch-Verified($name,$url,$hash){
  $file=Join-Path $cache $name
  if(-not(Test-Path -LiteralPath $file)){Invoke-WebRequest -UseBasicParsing $url -OutFile $file}
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash){throw "Dependency checksum mismatch: $name"}
  return $file
}
$package=Fetch-Verified 'webview2.zip' 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.3537.50/microsoft.web.webview2.1.0.3537.50.nupkg' '5EA526BBD728ADDA0DA4D31219267E96460494A427E4894C4E09D9F320F4B9AA'
$sdk=Join-Path $cache 'webview2'
Expand-Archive -LiteralPath $package -DestinationPath $sdk -Force
foreach($name in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')){Copy-Item -LiteralPath (Join-Path $sdk "lib/net462/$name") -Destination $output -Force}
Copy-Item -LiteralPath (Join-Path $sdk 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $output -Force
Copy-Item -LiteralPath (Join-Path $sdk 'LICENSE.txt') -Destination (Join-Path $output 'WebView2-LICENSE.txt') -Force
$fonts=@(
 @('Sarabun-Regular.ttf','sarabun/Sarabun-Regular.ttf','226D4F368FBC0457990DDEF2692679BADFD2C1A4E89E5AC4D43C10BA7743B2F1'),
 @('Sarabun-SemiBold.ttf','sarabun/Sarabun-SemiBold.ttf','C0BB057D86E4A12097D701AC0953597E315788D47A446F5B63A6604AB21DCEBA'),
 @('Sarabun-Bold.ttf','sarabun/Sarabun-Bold.ttf','D38308CA27D067B9A1B79006337C1F9A66C29AA016D96A9D88D3801DA7FA83B9'),
 @('NotoSansThai.ttf','notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf','5A1C559BB539583C8A1FD99D1C5B9491E5E14478C9CD2BD0970D5C3096CC9EF8'),
 @('Sarabun-OFL.txt','sarabun/OFL.txt','B26CAE1321380296BA8311B632A397D5EAC11B47197F9D0AA0B9310F1531AD60'),
 @('NotoSansThai-OFL.txt','notosansthai/OFL.txt','2E98FD23A52D253DB8612CD5942C8F2FF4111B21D2367050FDCA91D8CCC374A0')
)
foreach($font in $fonts){$file=Fetch-Verified $font[0] ('https://raw.githubusercontent.com/google/fonts/main/ofl/'+$font[1]) $font[2];Copy-Item -LiteralPath $file -Destination $output -Force}
$icon=Join-Path $output 'sapuri.ico'
& (Join-Path $repo 'tools/windows-printer-setup/build-icon.ps1') -Source (Join-Path $repo 'sapuri-app-icon-512.png') -Destination $icon
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$arguments=@('/nologo','/target:winexe','/platform:x64','/optimize+','/utf8output','/codepage:65001',('/out:'+(Join-Path $output 'SAPURI-Print.exe')),('/win32icon:'+$icon),('/win32manifest:'+(Join-Path $repo 'tools/windows-printer-setup/app.manifest')),'/r:System.dll','/r:System.Core.dll','/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Management.dll','/r:System.Web.Extensions.dll',('/r:'+(Join-Path $output 'Microsoft.Web.WebView2.Core.dll')),('/r:'+(Join-Path $output 'Microsoft.Web.WebView2.WinForms.dll')))
if($Testing){$arguments+='/define:PRINT_TESTING'}
$arguments+=@((Join-Path $PSScriptRoot 'Bridge.cs'),(Join-Path $PSScriptRoot 'NativePrinter.cs'),(Join-Path $PSScriptRoot 'Program.cs'))
& $compiler @arguments
if($LASTEXITCODE -ne 0){throw 'Print bridge compilation failed'}
Get-Item (Join-Path $output 'SAPURI-Print.exe') | Select-Object FullName,Length
