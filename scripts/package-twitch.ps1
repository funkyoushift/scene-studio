$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$distPath = Join-Path $projectRoot 'dist'
$outputPath = Join-Path $projectRoot 'outputs'
foreach ($page in @('config.html', 'viewer.html')) {
  $pagePath = Join-Path $distPath $page
  $html = [IO.File]::ReadAllText($pagePath)
  $firstScript = [regex]::Match($html, '<script[^>]*src="([^"]+)"')
  if ($firstScript.Groups[1].Value -ne 'https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js') {
    throw "Twitch Helper must be the first script in $page."
  }
}
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$archivePath = Join-Path $outputPath 'scene-studio-twitch-0.1.0.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$fileStream = [IO.File]::Open($archivePath, [IO.FileMode]::Create)
$archive = New-Object IO.Compression.ZipArchive($fileStream, [IO.Compression.ZipArchiveMode]::Create)
try {
  $packageFiles = @((Get-Item -LiteralPath (Join-Path $distPath 'config.html')), (Get-Item -LiteralPath (Join-Path $distPath 'viewer.html')))
  $packageFiles += @(Get-ChildItem -LiteralPath (Join-Path $distPath 'assets') -File -Recurse)
  foreach ($file in $packageFiles) {
    $relativePath = $file.FullName.Substring($distPath.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relativePath, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
  $fileStream.Dispose()
}
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256 | Format-List Path, Hash
