; SKYFALL Windows installer (NSIS 3, Modern UI 2). Built by tools/desktop/build-installer.mjs:
;   makensis -DVERSION=0.1.0 -DSRC=release\win-unpacked -DOUT=release\SKYFALL-Setup-0.1.0.exe -DICON=build\icon.ico build\installer.nsi
; Per-user install (no administrator prompt) into %LOCALAPPDATA%\Programs\SKYFALL with Start-menu and
; desktop shortcuts, a "SKYFALL Dedicated Server" shortcut, an Apps & features entry and an uninstaller.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
ManifestDPIAware true

!define APP "SKYFALL"
!define EXE "SKYFALL.exe"
!define UNINST "Uninstall SKYFALL.exe"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SKYFALL"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${APP}"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Battle royale with Apex-style movement, gunplay and legends.$\r$\n$\r$\nPlay offline against bots, join any server by IP, or host your own: friends join with your address (the installer adds a Dedicated Server shortcut too).$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Play ${APP} now"
!define MUI_COMPONENTSPAGE_NODESC

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; refuse to overwrite files of a running copy
!macro CheckRunning
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
  Pop $0
  ${If} $0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${APP} is running. Close it (and any dedicated server) and click Retry." IDRETRY +2
    Abort
  ${EndIf}
!macroend

Function .onInit
  !insertmacro CheckRunning
FunctionEnd

Section "${APP} (required)" SecApp
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; an upgrade replaces the previous build completely (user settings live in %APPDATA%\SKYFALL)
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\${UNINST}"

  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortCut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP}\${APP} Dedicated Server.lnk" "$INSTDIR\${EXE}" "--server" "$INSTDIR\${EXE}" 0
  CreateShortCut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\${UNINST}"

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${APP}"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\${UNINST}"'
  WriteRegStr HKCU "${REGKEY}" "QuietUninstallString" '"$INSTDIR\${UNINST}" /S'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" ${SIZE_KB}
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortCut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

Section "Uninstall"
  !insertmacro CheckRunning
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  ; only remove the folder when it is really ours
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    RMDir /r "$INSTDIR"
  ${EndIf}
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\${APP}"
SectionEnd
