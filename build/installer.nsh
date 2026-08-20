; The Windows Explorer "Open in Elena" verb.
;
; Written here so a fresh install has the entry before Elena is ever launched.
; src/main/shell/explorerContextMenu.ts writes the identical keys at runtime for
; the Settings toggle and to refresh the executable path after an update — the
; key name, the label, the --open-folder flag and the ElenaVerbState stamp must
; match that module — the stamp is how a launch decides the verb is already
; current and skips rewriting it, and it is written last so it can only mark a
; verb that is complete.
;
; HKCU, because the installer is per-user (nsis.perMachine is false): a
; per-machine write would need elevation Elena never asks for.
;
; %V is the only token Explorer expands for all three classes; %1 yields nothing
; on Directory\Background. The trailing \. keeps a drive root usable: %V expands
; to "C:\", and CommandLineToArgvW would read that backslash as escaping the
; closing quote.

!macro ElenaWriteVerb ROOT
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ElenaOpenFolder" "" "Open in Elena"
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ElenaOpenFolder" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ElenaOpenFolder\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%V\."'
  ; Last, so it marks a verb that is actually complete.
  WriteRegStr HKCU "Software\Classes\${ROOT}\shell\ElenaOpenFolder" "ElenaVerbState" 'Open in Elena|"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0|"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --open-folder "%V\."'
!macroend

!macro customInstall
  !insertmacro ElenaWriteVerb "Directory"
  !insertmacro ElenaWriteVerb "Directory\Background"
  !insertmacro ElenaWriteVerb "Drive"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\ElenaOpenFolder"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\ElenaOpenFolder"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\ElenaOpenFolder"
!macroend
