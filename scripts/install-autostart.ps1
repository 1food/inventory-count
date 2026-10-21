# 재물조사 서버 "PC 켜지면 자동 시작(로그온 불필요) / PC 끄면 안전 종료" 작업 스케줄러 등록.
# 한 번만 실행하면 된다. 반드시 관리자 권한 PowerShell에서 실행해야 한다(우클릭 > 관리자 권한으로 실행).
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$serverBat = Join-Path $root "scripts\server-start.bat"
$cfdVbs = Join-Path $root "scripts\cloudflared-start-hidden.vbs"
$stopPs1 = Join-Path $root "scripts\server-stop.ps1"

# .env 에서 값을 읽는다(없으면 기본값). 같은 PC에 운영판·체험판을 함께 둘 때 서로 구분하는 데 쓴다.
function Get-DotEnv([string]$name, [string]$default) {
    $envFile = Join-Path $root ".env"
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
            if ($line -match "^\s*$name\s*=(.*)$") {
                $value = $Matches[1].Trim()
                if ($value) { return $value }
            }
        }
    }
    return $default
}

# 같은 PC에 운영판과 체험판을 함께 둘 때 작업 이름이 겹치지 않도록 .env 의 TASK_PREFIX 를 쓴다.
$prefix = Get-DotEnv "TASK_PREFIX" "InventoryCountServer"

function Resolve-CompatiblePython {
    $candidates = @()
    $candidates += Join-Path $root "python\python.exe"   # 포터블 패키지에 들어 있는 Python
    if ($env:V3_PYTHON_EXE) { $candidates += $env:V3_PYTHON_EXE }

    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($minor in 14, 13, 12, 11, 10) {
            $resolved = $null
            try {
                $resolved = & $launcher.Source "-3.$minor" -c "import sys; print(sys.executable)" 2>$null
            } catch {
                # 해당 버전이 py.exe에 등록되지 않았으면 다른 설치 경로를 계속 확인한다.
                $resolved = $null
            }
            if ($LASTEXITCODE -eq 0 -and $resolved) { $candidates += $resolved.Trim() }
        }
    }
    foreach ($version in 314, 313, 312, 311, 310) {
        $candidates += Join-Path $env:ProgramFiles "Python$version\python.exe"
        $candidates += Join-Path $env:ProgramFiles "Python\Python$version\python.exe"
        $candidates += Join-Path $env:LocalAppData "Programs\Python\Python$version\python.exe"
    }
    $candidates += Join-Path $root ".venv\Scripts\python.exe"
    $pathPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pathPython) { $candidates += $pathPython.Source }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $compatible = $false
        try {
            & $candidate -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
            $compatible = $LASTEXITCODE -eq 0
        } catch {
            $compatible = $false
        }
        if ($compatible) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    throw "Python 3.10 이상을 찾지 못했습니다. Python 3.14를 설치한 뒤 다시 실행하세요."
}

$pythonExe = Resolve-CompatiblePython

Write-Host "재물조사 서버 자동 시작/안전 종료 작업을 등록합니다..."
Write-Host "  - 사용할 Python: $pythonExe"

# SYSTEM 계정으로 실행 -> 아무도 로그온하지 않아도 부팅과 동시에 시작/필요 시 종료 가능
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

# 1) 부팅 시 자동 시작 (로그온 불필요, 창 없이 백그라운드)
$startAction = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/d /c `"`"$serverBat`" `"$pythonExe`"`""
$startTrigger = New-ScheduledTaskTrigger -AtStartup
$startSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "$prefix-AutoStart" `
    -Action $startAction -Trigger $startTrigger -Principal $principal -Settings $startSettings `
    -Description "재물조사 서버 자동 시작 (부팅 시, 로그온 불필요, 창 없음)" -Force | Out-Null
Write-Host "  - $prefix-AutoStart 등록 완료 (부팅 시 자동 시작, 로그온 불필요)"

# 1-1) 외부 접속(클라우드플레어 터널)은 이 폴더에 cloudflared.exe 가 있을 때만 함께 자동 시작한다.
#      일반 기관 설치(사내 와이파이 전용)가 모르는 사이 인터넷에 공개되지 않게 하기 위해서다.
if (Test-Path -LiteralPath (Join-Path $root "cloudflared.exe")) {
    $cfdAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$cfdVbs`""
    Register-ScheduledTask -TaskName "$prefix-Cloudflare-AutoStart" `
        -Action $cfdAction -Trigger $startTrigger -Principal $principal -Settings $startSettings `
        -Description "재물조사 클라우드플레어 터널 자동 시작 (부팅 시, 로그온 불필요, 창 없음)" -Force | Out-Null
    Write-Host "  - $prefix-Cloudflare-AutoStart 등록 완료 (부팅 시 자동 시작, 로그온 불필요)"
} else {
    Unregister-ScheduledTask -TaskName "$prefix-Cloudflare-AutoStart" -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "  - cloudflared.exe 가 없어 외부 접속 터널은 등록하지 않았습니다(사내 와이파이 전용)"
}

# 2) 시스템 종료/재시작이 시작되는 순간 서버 + 클라우드플레어 안전 종료
$stopAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$stopPs1`""
$eventTriggerClass = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace "Root/Microsoft/Windows/TaskScheduler"
$eventTrigger = New-CimInstance -CimClass $eventTriggerClass -ClientOnly
$eventTrigger.Subscription = @'
<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='User32'] and EventID=1074]]</Select></Query></QueryList>
'@
$eventTrigger.Enabled = $true
Register-ScheduledTask -TaskName "$prefix-SafeStop" `
    -Action $stopAction -Trigger $eventTrigger -Principal $principal `
    -Description "재물조사 서버 + 클라우드플레어 안전 종료 (시스템 종료/재시작이 시작될 때)" -Force | Out-Null
Write-Host "  - $prefix-SafeStop 등록 완료 (종료/재시작 시작 시 서버+터널 정지)"

Write-Host ""
Write-Host "완료되었습니다. 상태 확인: Get-ScheduledTask -TaskName $prefix-*"
Write-Host "지금 바로 실행하려면:"
Write-Host "  Start-ScheduledTask -TaskName $prefix-AutoStart"
