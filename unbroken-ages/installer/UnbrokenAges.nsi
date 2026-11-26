; Unbroken Ages — Windows installer (NSIS 3, Modern UI 2).
; Built by tools/package-windows.sh, which exports the game to build/windows first.
; makensis -DVERSION=x.y.z -DSRCDIR=<exported game folder> -DOUTFILE=<setup.exe> installer/UnbrokenAges.nsi

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "..\build\windows"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\build\UnbrokenAges-Setup.exe"
!endif

!define APPNAME "Unbroken Ages"
!define EXENAME "UnbrokenAges.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\UnbrokenAges"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\UnbrokenAges" "InstallDir"
RequestExecutionLevel admin
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "UnbrokenAges.ico"
!define MUI_UNICON "UnbrokenAges.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "One people. Every age.$\r$\n$\r$\nThis will install ${APPNAME} ${VERSION}, a turn-based 4X strategy game, on your computer. Everything it needs (including the .NET runtime) is bundled; nothing else has to be installed.$\r$\n$\r$\nA graphics card with Vulkan or DirectX 12 support is recommended. A $\"Safe Mode$\" shortcut is included for older or integrated graphics.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Play ${APPNAME} now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\HOW-TO-PLAY.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the quick-start guide"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} needs a 64-bit version of Windows."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "!${APPNAME} (required)" SecGame
  SectionIn RO
  ; An older install may still be running; files in use cannot be replaced.
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  ; Replace the game files cleanly (saves and settings live in %APPDATA% and are kept).
  RMDir /r "$INSTDIR\data_UnbrokenAges.Client_windows_x86_64"
  RMDir /r "$INSTDIR\content"
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"
  File "UnbrokenAges.ico"

  WriteRegStr HKLM "Software\UnbrokenAges" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\UnbrokenAges.ico"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINSTKEY}" "EstimatedSize" "$0"

  ; Start menu (all users).
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\UnbrokenAges.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME} (Safe Mode).lnk" "$INSTDIR\${EXENAME}" "--rendering-method gl_compatibility" "$INSTDIR\UnbrokenAges.ico" 0 SW_SHOWNORMAL "" "Runs with the OpenGL renderer for older or integrated graphics"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\How to Play.lnk" "$INSTDIR\HOW-TO-PLAY.txt"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Saves and Logs.lnk" "$APPDATA\Godot\app_userdata\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Desktop shortcut" SecDesktop
  SetShellVarContext all
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\UnbrokenAges.ico" 0
SectionEnd

Section "Allow multiplayer through Windows Firewall" SecFirewall
  ; Direct IP games use TCP 47620; LAN discovery uses UDP broadcast.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="${APPNAME}" dir=in action=allow program="$INSTDIR\${EXENAME}" enable=yes profile=private'
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecGame} "The game, its content and the bundled .NET runtime."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Put an ${APPNAME} shortcut on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecFirewall} "Let other players on your private network join games you host (Direct IP / LAN)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXENAME}"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="${APPNAME}"'
  SetShellVarContext all
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR\data_UnbrokenAges.Client_windows_x86_64"
  RMDir /r "$INSTDIR\content"
  RMDir /r "$INSTDIR\mods"
  Delete "$INSTDIR\${EXENAME}"
  Delete "$INSTDIR\UnbrokenAges.pck"
  Delete "$INSTDIR\UnbrokenAges.ico"
  Delete "$INSTDIR\HOW-TO-PLAY.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTKEY}"
  DeleteRegKey HKLM "Software\UnbrokenAges"
  ; Saves in %APPDATA%\Godot\app_userdata\Unbroken Ages are deliberately kept.
SectionEnd
