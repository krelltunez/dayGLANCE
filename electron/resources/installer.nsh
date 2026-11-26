; dayGLANCE NSIS customisation (electron-builder `nsis.include`).
;
; #2446: an in-place upgrade keeps the user's existing shortcuts (electron-
; builder's keepShortcuts path) and does not re-stamp their AppUserModelID, so
; a shortcut written by an older install, or one Windows rewrote, kept a
; different ID from the one the app now sets at startup (windowsAppId.ts), and
; a window and its shortcut grouped as two taskbar buttons. Re-stamp the Start
; Menu and desktop shortcuts the installer owns on every install. The same
; call electron-builder makes when it creates them; a missing shortcut (the
; user deleted it) is left missing.
;
; Taskbar pins are Windows' files, not ours, and are left alone: a pin made
; under the old ID needs one unpin and re-pin (release notes).
!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}
  ${if} ${FileExists} "$newDesktopLink"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}
!macroend
