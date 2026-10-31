; Ilelah Business Suite - Windows installer (per-user, no admin rights needed)
!define APP "Ilelah Business Suite"
!define VER "1.17.0"
!define EXE "Ilelah Business Suite.exe"
!include "MUI2.nsh"
Name "${APP}"
OutFile "Ilelah-Business-Suite-Setup-${VER}.exe"
Unicode true
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Ilelah Business Suite"
InstallDirRegKey HKCU "Software\IlelahBusinessSuite" "Dir"
SetCompressor /SOLID lzma
!define MUI_ICON "build\icon.ico"
!define MUI_UNICON "build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP} now"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "1.17.0.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "CompanyName" "Ilelah Technologies"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "FileVersion" "${VER}"

Section "Install"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  SetOutPath "$INSTDIR"
  File /r "dist\win-unpacked\*.*"
  File "build\icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\IlelahBusinessSuite" "Dir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite" "DisplayName" "${APP}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite" "Publisher" "Ilelah Technologies"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

; Uninstalling removes the program only. Shop records stay in %APPDATA%\Ilelah Business Suite.
Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\IlelahBusinessSuite"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\IlelahBusinessSuite"
SectionEnd
