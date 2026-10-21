; 재물조사 웹앱 설치 프로그램 (Inno Setup 6)
; 직접 컴파일하지 말고 python scripts/build_release.py --installer 로 만든다.
; (포터블 파일을 release\stage\ 에 모은 뒤 SourceDir·AppVersion·OutputDir 을 넘겨 컴파일한다)

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #error SourceDir 를 지정해야 합니다 (build_release.py --installer 사용)
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#define AppPort "8200"
#define TaskPrefix "InventoryCountServer"
#define FirewallRule "InventoryCount (재물조사)"

[Setup]
AppId={{8F0C2B5E-6D1A-4C3B-9E7F-2A4D5B6C7E81}
AppName=재물조사
AppVersion={#AppVersion}
AppVerName=재물조사 {#AppVersion}
AppPublisher=재물조사 웹앱
; Program Files 는 일반 사용자가 쓸 수 없어 설정 화면이 저장하지 못한다. 드라이브 바로 아래에 둔다.
DefaultDirName={sd}\InventoryCount
DefaultGroupName=재물조사
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
DirExistsWarning=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=inventory-count-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=재물조사 {#AppVersion}
; 설치할 때 비영리 기관 이용 허락서에 동의를 받는다(UTF-8 BOM 텍스트).
LicenseFile={#SourceDir}\LICENSE

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[CustomMessages]
korean.TaskDesktop=바탕화면에 바로가기 만들기
korean.TaskFirewall=같은 와이파이의 휴대폰이 접속할 수 있게 Windows 방화벽 허용 (권장)
korean.TaskAutostart=PC를 켜면 자동으로 서버 시작 — 로그인하지 않아도 실행 (권장)
korean.OpenApp=재물조사 열기 (처음이면 설정 화면이 열립니다)
korean.StartNow=지금 서버 시작하기
korean.Registering=자동 시작을 등록하는 중...
korean.AskDeleteData=재물조사 웹앱의 자료도 함께 지울까요?%n%n지우는 것: 실사 결과·사진·이력, 설정(.env, 접근 코드), 기관 엑셀(고정자산대장·공간목록·재물조사표), 로고, 프로그램 폴더 안의 백업%n위치: %1%n%n[예] 모두 지웁니다. 되돌릴 수 없습니다.%n[아니요] 남겨 둡니다. 다시 설치하면 그대로 이어서 쓸 수 있습니다.%n%n(설정 화면에서 따로 정한 외장 드라이브·NAS 백업 폴더는 지우지 않습니다.)
korean.KeptData=실사 자료와 설정을 남겨 두었습니다.%n다시 설치하면 그대로 이어서 쓸 수 있습니다.%n%n나중에 지우려면 이 폴더를 직접 삭제하세요:%n%1
korean.DeletedData=재물조사 웹앱의 자료를 모두 지웠습니다.

[Tasks]
Name: "desktopicon"; Description: "{cm:TaskDesktop}"
Name: "firewall"; Description: "{cm:TaskFirewall}"
Name: "autostart"; Description: "{cm:TaskAutostart}"

[Dirs]
; 서버(작업 스케줄러=SYSTEM, start.bat=사용자)와 설정 화면이 .env·data·assets·branding 에 쓴다.
Name: "{app}"; Permissions: users-modify
Name: "{app}\data"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\assets"; Permissions: users-modify; Flags: uninsneveruninstall
Name: "{app}\branding"; Permissions: users-modify; Flags: uninsneveruninstall

[InstallDelete]
; 업데이트 때 예전 프로그램 파일을 깨끗이 지운다. 기관 자료(.env·data·backups·assets·branding)는 건드리지 않는다.
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\.runtime-py312"
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\static"
Type: filesandordirs; Name: "{app}\scripts"
Type: filesandordirs; Name: "{app}\tests"
Type: filesandordirs; Name: "{app}\docs"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "\assets\*,\branding\*"; Flags: recursesubdirs createallsubdirs ignoreversion
; 예시 엑셀·로고 안내는 처음 설치할 때만 넣는다(업데이트가 기관 자료를 덮어쓰지 않게).
Source: "{#SourceDir}\assets\*"; DestDir: "{app}\assets"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "{#SourceDir}\branding\*"; DestDir: "{app}\branding"; Flags: onlyifdoesntexist uninsneveruninstall

[INI]
Filename: "{app}\재물조사 열기.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{#AppPort}/"
Filename: "{app}\재물조사 기관 설정.url"; Section: "InternetShortcut"; Key: "URL"; String: "http://localhost:{#AppPort}/setup"

[Icons]
Name: "{group}\재물조사 열기"; Filename: "{app}\재물조사 열기.url"
Name: "{group}\기관 설정 · 백업"; Filename: "{app}\재물조사 기관 설정.url"
Name: "{group}\서버 시작 (창으로)"; Filename: "{app}\start.bat"; WorkingDir: "{app}"
Name: "{group}\서버 끄기"; Filename: "{app}\scripts\server-stop.bat"; WorkingDir: "{app}"
Name: "{group}\지금 백업하기"; Filename: "{app}\backup.bat"; WorkingDir: "{app}"
Name: "{group}\설치·운영 안내"; Filename: "notepad.exe"; Parameters: """{app}\docs\설치_운영_안내.md"""
Name: "{group}\재물조사 제거"; Filename: "{uninstallexe}"
; 자동 시작이면 서버가 늘 켜져 있으니 브라우저 바로가기, 아니면 서버를 켜는 바로가기를 둔다.
Name: "{autodesktop}\재물조사"; Filename: "{app}\재물조사 열기.url"; Tasks: desktopicon and autostart
Name: "{autodesktop}\재물조사 시작"; Filename: "{app}\start.bat"; WorkingDir: "{app}"; Tasks: desktopicon and not autostart

[Run]
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#FirewallRule}"""; Flags: runhidden; Tasks: firewall
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""{#FirewallRule}"" dir=in action=allow program=""{app}\python\python.exe"" enable=yes profile=private,domain"; Flags: runhidden; Tasks: firewall
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\install-autostart.ps1"""; Flags: runhidden waituntilterminated; StatusMsg: "{cm:Registering}"; Tasks: autostart
Filename: "powershell.exe"; Parameters: "-NoProfile -Command ""Start-ScheduledTask -TaskName '{#TaskPrefix}-AutoStart'"""; Flags: runhidden; Tasks: autostart
; 다시 설치하며 자동 시작을 끄면 등록을 해제한다(처음 설치라면 지울 것이 없어 그냥 끝난다).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-autostart.ps1"""; Flags: runhidden; Tasks: not autostart
; 마침 화면: 서버가 응답할 때까지 기다렸다가 브라우저를 연다(처음이면 / → /setup 으로 이동).
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -Command ""for($i=0;$i -lt 60;$i++){{try{{Invoke-WebRequest -UseBasicParsing http://localhost:{#AppPort}/api/health -TimeoutSec 2|Out-Null;break}catch{{Start-Sleep 1}};Start-Process 'http://localhost:{#AppPort}/'"""; Description: "{cm:OpenApp}"; Flags: postinstall nowait runhidden runasoriginaluser skipifsilent; Tasks: autostart
Filename: "{app}\start.bat"; WorkingDir: "{app}"; Description: "{cm:StartNow}"; Flags: postinstall nowait shellexec runasoriginaluser skipifsilent; Tasks: not autostart

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -Command ""Stop-ScheduledTask -TaskName '{#TaskPrefix}-AutoStart' -ErrorAction SilentlyContinue"""; Flags: runhidden; RunOnceId: "StopTask"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\server-stop.ps1"""; Flags: runhidden; RunOnceId: "StopServer"
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\uninstall-autostart.ps1"""; Flags: runhidden; RunOnceId: "RemoveAutostart"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#FirewallRule}"""; Flags: runhidden; RunOnceId: "RemoveFirewall"

[UninstallDelete]
Type: files; Name: "{app}\재물조사 열기.url"
Type: files; Name: "{app}\재물조사 기관 설정.url"

[Code]
// 업데이트: 파일을 바꾸기 전에 돌고 있는 서버를 끄고 지금 자료를 백업한다.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir: String;
  Code: Integer;
begin
  Result := '';
  Dir := WizardDirValue;
  if FileExists(Dir + '\scripts\server-stop.ps1') then
  begin
    Exec('powershell.exe', '-NoProfile -Command "Stop-ScheduledTask -TaskName ''{#TaskPrefix}-AutoStart'' -ErrorAction SilentlyContinue"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
    Exec('powershell.exe', '-NoProfile -ExecutionPolicy Bypass -File "' + Dir + '\scripts\server-stop.ps1"',
      Dir, SW_HIDE, ewWaitUntilTerminated, Code);
    if FileExists(Dir + '\backup.bat') and DirExists(Dir + '\data') then
      Exec(ExpandConstant('{cmd}'), '/c ""' + Dir + '\backup.bat" --quiet"', Dir, SW_HIDE, ewWaitUntilTerminated, Code);
  end;
end;

// 제거: 프로그램을 지운 뒤 남은 자료(data·backups·.env·assets·branding)도 지울지 묻는다.
// 되돌릴 수 없으므로 기본 선택은 [아니요]이고, 조용한 제거에서는 묻지 않고 남긴다.
var
  DeleteData: Boolean;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  App: String;
begin
  App := ExpandConstant('{app}');
  if (CurUninstallStep = usUninstall) and not UninstallSilent then
    DeleteData := MsgBox(FmtMessage(CustomMessage('AskDeleteData'), [App]),
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  if (CurUninstallStep = usPostUninstall) and DirExists(App) then
  begin
    if DeleteData then
    begin
      DelTree(App, True, True, True);
      if not UninstallSilent then
        MsgBox(CustomMessage('DeletedData'), mbInformation, MB_OK);
    end
    else if not UninstallSilent then
      MsgBox(FmtMessage(CustomMessage('KeptData'), [App]), mbInformation, MB_OK);
  end;
end;
