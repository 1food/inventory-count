# 이 폴더의 재물조사 서버 + 클라우드플레어 터널 프로세스를 찾아서 종료한다.
# - 컴퓨터 종료/재시작이 시작될 때(작업 스케줄러: <TASK_PREFIX>-SafeStop) 자동 실행되거나,
#   사용자가 필요할 때 직접 더블클릭(server-stop.bat)으로 실행할 수 있다.
# - 같은 PC의 다른 재물조사 서버(예: 운영판 8200 / 체험판 8300)는 건드리지 않도록
#   .env 의 V3_PORT 와 터널 토큰(없으면 해당 포트로 연 임시 터널)으로 대상을 고른다.
# - DB는 WAL 모드 + 요청 단위 커밋이라 프로세스를 종료해도 데이터가 깨지지 않는다.

$root = Split-Path -Parent $PSScriptRoot
$serverLog = Join-Path $root "data\server.log"
$cfdLog = Join-Path $root "data\cloudflared.log"
New-Item -ItemType Directory -Force -Path (Join-Path $root "data") | Out-Null

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

$port = Get-DotEnv "V3_PORT" "8200"
$token = Get-DotEnv "CLOUDFLARE_TUNNEL_TOKEN" ""

function Stop-Matching {
    param($processName, [scriptblock]$match, $logPath)
    $procs = Get-CimInstance Win32_Process -Filter "Name='$processName'" | Where-Object { & $match $_.CommandLine }
    if (-not $procs) {
        Add-Content -Path $logPath -Value "[$(Get-Date)] server-stop: 실행 중인 $processName 없음"
        return
    }
    foreach ($p in $procs) {
        Add-Content -Path $logPath -Value "[$(Get-Date)] server-stop: PID $($p.ProcessId) ($processName) 종료 시도"
        try {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
            Add-Content -Path $logPath -Value "[$(Get-Date)] server-stop: PID $($p.ProcessId) 종료 완료"
        } catch {
            Add-Content -Path $logPath -Value "[$(Get-Date)] server-stop: PID $($p.ProcessId) 종료 실패 - $($_.Exception.Message)"
        }
    }
}

Stop-Matching "python.exe" { param($c) $c -match 'uvicorn.*app\.main:app' -and $c -match "--port\s+$port(\s|$)" } $serverLog
if ($token) {
    Stop-Matching "cloudflared.exe" { param($c) $c -and $c.Contains($token) } $cfdLog
} else {
    Stop-Matching "cloudflared.exe" { param($c) $c -match "--url\s+http://localhost:$port(\s|$)" } $cfdLog
}
