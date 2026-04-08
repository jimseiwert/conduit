# SNC Tunnel CLI installer for Windows (PowerShell)
# Usage: irm https://get.snc.digital/tunnel/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "snc/tunnel"
$Binary = "snc"
$InstallDir = "$env:LOCALAPPDATA\Programs\snc"

# Get latest release
Write-Host "Fetching latest release..."
$Release = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/latest"
$Tag = $Release.tag_name

$Url = "https://github.com/$Repo/releases/download/$Tag/$Binary-windows-x64.exe"
$TmpPath = "$env:TEMP\$Binary.exe"

Write-Host "Downloading $Binary $Tag for Windows x64..."
Invoke-WebRequest -Uri $Url -OutFile $TmpPath -UseBasicParsing

# Create install dir
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

Move-Item -Force $TmpPath "$InstallDir\$Binary.exe"

# Add to PATH if not already present
$CurrentPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$InstallDir*") {
  [System.Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to PATH"
}

Write-Host ""
Write-Host "SNC Tunnel CLI installed successfully!"
Write-Host "Restart your terminal, then run: snc --help"
