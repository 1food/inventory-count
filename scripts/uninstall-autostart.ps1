# 재물조사 서버 자동 시작/안전 종료 작업 스케줄러 등록 해제(관리자 권한 PowerShell).
#   powershell -ExecutionPolicy Bypass -File uninstall-autostart.ps1
$root = Split-Path -Parent $PSScriptRoot

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

$prefix = Get-DotEnv "TASK_PREFIX" "InventoryCountServer"
foreach ($suffix in "AutoStart", "Cloudflare-AutoStart", "SafeStop") {
    Unregister-ScheduledTask -TaskName "$prefix-$suffix" -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Host "등록된 자동 시작/안전 종료 작업($prefix-*)을 해제했습니다."
