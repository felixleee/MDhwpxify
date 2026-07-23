<#
  md2hwpx 배포 빌드 스크립트 (MDeautify / MDocify 와 동일 구조)
  - 멀티파일 소스(md2hwpx-app/resources)에서 배포본을 생성합니다.
  - 결과물은 release\ 폴더에 모입니다.

  사용법:
    .\build.ps1           # HTML + exe 둘 다
    .\build.ps1 -Html     # 단일 HTML만
    .\build.ps1 -Exe      # exe만
#>
param(
  [switch]$Html,
  [switch]$Exe
)
$ErrorActionPreference = "Stop"
$root    = $PSScriptRoot
$appDir  = Join-Path $root "md2hwpx-app"
$resDir  = Join-Path $appDir "resources"
$release = Join-Path $root "release"
New-Item -ItemType Directory -Force $release | Out-Null

# 플래그가 하나도 없으면 둘 다
$doHtml = $Html -or (-not $Html -and -not $Exe)
$doExe  = $Exe  -or (-not $Html -and -not $Exe)

if ($doHtml) {
  Write-Host "== 단일 HTML 빌드 ==" -ForegroundColor Cyan
  node (Join-Path $root "build\inline.mjs") $resDir (Join-Path $release "MDhwpxify.html")
}

if ($doExe) {
  Write-Host "== 단일 exe 빌드 (Neutralino --embed-resources) ==" -ForegroundColor Cyan
  Push-Location $appDir
  try {
    npx --yes @neutralinojs/neu build --embed-resources
  } finally {
    Pop-Location
  }
  $built = Join-Path $appDir "dist\md2hwpx-app\md2hwpx-app-win_x64.exe"
  if (-not (Test-Path $built)) { throw "빌드 산출물을 찾을 수 없음: $built" }
  $outExe = Join-Path $release "MDhwpxify.exe"
  Copy-Item $built $outExe -Force

  # ★ exe 리소스 패치: 파일 아이콘 + 버전 문자열 (rcedit)
  $rcedit = Join-Path $root "tools\rcedit-x64.exe"
  $icon   = Join-Path $resDir "icons\appIcon.ico"
  if (Test-Path $rcedit) {
    $cfg = Get-Content (Join-Path $appDir "neutralino.config.json") -Raw | ConvertFrom-Json
    $ver = $cfg.version
    # 갓 복사된 exe를 백신 실시간 검사가 잠그면 rcedit 이 exit 1 로 실패 → 최대 5회 재시도.
    $rcOk = $false
    for ($try = 1; $try -le 5; $try++) {
      & $rcedit $outExe `
        --set-icon $icon `
        --set-version-string "FileDescription" "MDhwpxify - Markdown to HWPX" `
        --set-version-string "ProductName" "MDhwpxify" `
        --set-file-version "$ver.0" `
        --set-product-version "$ver" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $rcOk = $true; break }
      if ($try -lt 5) { Write-Host "[EXE] rcedit 패치 실패(파일 잠금 추정, exit $LASTEXITCODE) → ${try}/5 재시도..." -ForegroundColor Yellow; Start-Sleep -Milliseconds 800 }
    }
    if ($rcOk) { Write-Host "[EXE] 아이콘+버전 리소스 패치 완료 (아이콘, 설명='MDhwpxify - Markdown to HWPX', 버전=$ver)" -ForegroundColor DarkGray }
    else { Write-Host "[EXE] rcedit 패치 실패(5회 소진) — exe 는 유효하나 아이콘/메타데이터는 기본값." -ForegroundColor Red }
  } else {
    Write-Host "[EXE] rcedit 없음 → 아이콘/버전 패치 건너뜀 (tools\rcedit-x64.exe)" -ForegroundColor Yellow
  }
  Write-Host "[EXE] release\MDhwpxify.exe (단일 파일, 리소스 내장) 생성" -ForegroundColor Green

  # ★ SHA256 체크섬 생성 (반드시 rcedit 패치 '이후' 최종 exe 기준). 자동 업데이트 무결성 검증용.
  #   릴리스에 MDhwpxify.exe 와 MDhwpxify.exe.sha256 을 함께 올리면, 앱 내 업데이터가 다운로드 후 해시를 검증함.
  $hash = (Get-FileHash $outExe -Algorithm SHA256).Hash.ToLower()
  Set-Content -Path "$outExe.sha256" -Value "$hash  MDhwpxify.exe" -NoNewline -Encoding ascii   # sha256sum 호환 형식
  Write-Host "[EXE] release\MDhwpxify.exe.sha256 = $hash" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "완료. release\ 내용:" -ForegroundColor Green
Get-ChildItem $release | Format-Table Name, @{N="Size(KB)";E={[math]::Round($_.Length/1KB)}} -AutoSize
