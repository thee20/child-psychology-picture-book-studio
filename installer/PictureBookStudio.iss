; Inno Setup script — Child Psychology Picture Book Studio
#define MyAppName "Child Psychology Picture Book Studio"
#define MyAppNameZh "儿童心理绘本工坊"
#define MyAppVersion "1.3.4"
#define MyAppPublisher "Child Psychology Picture Book Studio"
#define MyAppURL "https://github.com/thee20/child-psychology-picture-book-studio"
#define MyAppExeName "PictureBookStudio-Launcher.exe"

[Setup]
AppId={{8F3C2A1B-9D4E-4F6A-B2C1-7E5D9A0B3C21}
AppName={#MyAppNameZh}
AppVersion={#MyAppVersion}
AppVerName={#MyAppNameZh} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\ChildPsychologyPictureBookStudio
DefaultGroupName={#MyAppNameZh}
DisableProgramGroupPage=yes
LicenseFile=
OutputDir=..\dist
OutputBaseFilename=ChildPsychologyPictureBookStudio-Setup-{#MyAppVersion}
SetupIconFile=..\app.ico
UninstallDisplayIcon={app}\app.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
MinVersion=10.0
InfoBeforeFile=
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppNameZh} Installer
VersionInfoProductName={#MyAppNameZh}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop icon"; GroupDescription: "Additional icons:"; Flags: checkedonce

[Files]
; Root application
Source: "..\dist\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppNameZh}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\Uninstall {#MyAppNameZh}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppNameZh}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppNameZh}"; Flags: nowait postinstall skipifsilent; WorkingDir: "{app}"

[Code]
function NodeExists: Boolean;
begin
  Result := FileExists(ExpandConstant('{pf}\nodejs\node.exe'))
    or FileExists(ExpandConstant('{pf32}\nodejs\node.exe'))
    or FileExists(ExpandConstant('{localappdata}\Programs\node\node.exe'))
    or FileExists(ExpandConstant('{localappdata}\Programs\nodejs\node.exe'));
end;

function WebView2Exists: Boolean;
var
  Value: String;
begin
  { Evergreen WebView2 Runtime (user or machine scope) }
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Value)
    or RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Value)
    or RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Value)
    or FileExists(ExpandConstant('{pf}\Microsoft\EdgeWebView\Application\msedgewebview2.exe'))
    or FileExists(ExpandConstant('{localappdata}\Microsoft\EdgeWebView\Application\msedgewebview2.exe'));
  if Result and (Value = '0.0.0.0') then
    Result := False;
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if not NodeExists then
  begin
    MsgBox(
      'Node.js was not found on this computer.'#13#10#13#10 +
      'Please install Node.js 20 LTS (or newer) from https://nodejs.org/'#13#10 +
      'then run this installer again.'#13#10#13#10 +
      '本地未检测到 Node.js。请先安装 Node.js 20 或更高版本后再安装本程序。',
      mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if not WebView2Exists then
  begin
    MsgBox(
      'Microsoft Edge WebView2 Runtime was not found.'#13#10#13#10 +
      'Please install the Evergreen WebView2 Runtime from:'#13#10 +
      'https://developer.microsoft.com/microsoft-edge/webview2/'#13#10 +
      'then run this installer again.'#13#10#13#10 +
      '本地未检测到 WebView2 运行时。请先安装 Microsoft Edge WebView2 Runtime 后再安装本程序。',
      mbError, MB_OK);
    Result := False;
  end;
end;
