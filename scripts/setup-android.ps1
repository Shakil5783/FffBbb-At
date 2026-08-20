param(
  [Parameter(Mandatory = $true)]
  [string]$SdkRoot,

  [string]$AvdName = "DroidDeck_Android_11"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-DD {
  param([string]$Phase, [string]$Message)
  Write-Output "DD:$Phase`:$Message"
}

function Find-JavaHome {
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += $env:JAVA_HOME }
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles "Android\Android Studio\jbr"
    $candidates += Get-ChildItem (Join-Path $env:ProgramFiles "Microsoft") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
    $candidates += Get-ChildItem (Join-Path $env:ProgramFiles "Eclipse Adoptium") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
    $candidates += Get-ChildItem (Join-Path $env:ProgramFiles "Java") -Directory -Filter "jdk-17*" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path (Join-Path $candidate "bin\java.exe"))) {
      return $candidate
    }
  }
  return $null
}

try {
  Write-DD "java" "Checking the Java 17 runtime"
  $javaHome = Find-JavaHome
  if (-not $javaHome) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
      throw "Java 17 is required. Install Microsoft OpenJDK 17 or Android Studio, then run setup again."
    }
    Write-DD "java" "Installing Microsoft OpenJDK 17"
    & $winget.Source install --id Microsoft.OpenJDK.17 --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "Java 17 installation failed. Install Microsoft OpenJDK 17 manually, then retry."
    }
    $javaHome = Find-JavaHome
  }
  if (-not $javaHome) {
    throw "Java 17 could not be located after installation. Restart DroidDeck and retry."
  }
  $env:JAVA_HOME = $javaHome
  $env:Path = "$(Join-Path $javaHome 'bin');$env:Path"

  New-Item -ItemType Directory -Force -Path $SdkRoot | Out-Null
  $cmdlineRoot = Join-Path $SdkRoot "cmdline-tools\latest"
  $sdkManager = Join-Path $cmdlineRoot "bin\sdkmanager.bat"
  $avdManager = Join-Path $cmdlineRoot "bin\avdmanager.bat"

  if (-not (Test-Path $sdkManager)) {
    Write-DD "download" "Downloading official Android command-line tools"
    $downloadUrl = "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"
    $tempRoot = Join-Path $env:TEMP "DroidDeck-Android-Setup"
    $archive = Join-Path $tempRoot "commandline-tools.zip"
    $expanded = Join-Path $tempRoot "expanded"
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $expanded | Out-Null
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -UseBasicParsing
    Expand-Archive -Path $archive -DestinationPath $expanded -Force
    New-Item -ItemType Directory -Force -Path $cmdlineRoot | Out-Null
    Copy-Item (Join-Path $expanded "cmdline-tools\*") $cmdlineRoot -Recurse -Force
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $sdkManager)) {
    throw "Android SDK manager could not be installed."
  }

  $env:ANDROID_SDK_ROOT = $SdkRoot
  $env:ANDROID_HOME = $SdkRoot
  [Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", $SdkRoot, "User")
  [Environment]::SetEnvironmentVariable("ANDROID_HOME", $SdkRoot, "User")

  Write-DD "licenses" "Accepting Android SDK licenses"
  $licenseAnswers = 1..200 | ForEach-Object { "y" }
  $licenseAnswers | & $sdkManager "--sdk_root=$SdkRoot" --licenses | ForEach-Object {
    if ($_ -match "accepted|license") { Write-Output $_ }
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Android SDK licenses were not accepted."
  }

  Write-DD "packages" "Installing Android 11 image and emulator tools"
  $packages = @(
    "platform-tools",
    "emulator",
    "platforms;android-30",
    "system-images;android-30;google_apis;x86_64"
  )
  & $sdkManager "--sdk_root=$SdkRoot" $packages
  if ($LASTEXITCODE -ne 0) {
    throw "One or more Android SDK packages failed to install."
  }

  Write-DD "avd" "Creating the Android 11 virtual device"
  $existingAvds = & $avdManager list avd -c
  if ($existingAvds -notcontains $AvdName) {
    "no" | & $avdManager create avd --force --name $AvdName --package "system-images;android-30;google_apis;x86_64" --device "pixel_5"
    if ($LASTEXITCODE -ne 0) {
      throw "The Android 11 virtual device could not be created."
    }
  }

  $avdHome = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { Join-Path $env:USERPROFILE ".android\avd" }
  $configFile = Join-Path $avdHome "$AvdName.avd\config.ini"
  if (Test-Path $configFile) {
    $config = Get-Content $configFile
    if ($config -notmatch "^hw.keyboard=") { Add-Content $configFile "hw.keyboard=yes" }
    if ($config -notmatch "^showDeviceFrame=") { Add-Content $configFile "showDeviceFrame=no" }
  }

  Write-DD "done" "Android 11 is ready to launch"
  exit 0
}
catch {
  Write-Error $_.Exception.Message
  Write-Output "DD:error:$($_.Exception.Message)"
  exit 1
}
