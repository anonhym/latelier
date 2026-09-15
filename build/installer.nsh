; Custom NSIS installer hooks for electron-builder.
;
; The default `customCheckAppRunning` macro in electron-builder's NSIS
; template scans for windows whose title matches productName and refuses
; to install if any are found. That detection has a long-standing
; false-positive bug on fresh installs — even with no app instance
; running, the user sees the modal "MongoLab cannot be closed, close
; manually and click retry" and gets stuck.
;
; We replace the macro with an empty body. Trade-off: if the user really
; does have MongoLab running during an upgrade, the installer will
; happily try to overwrite the locked .exe and fail with a Windows
; "file in use" error instead of the friendly NSIS dialog. Acceptable —
; the user can close the app and retry; the friendly dialog wasn't
; doing them any favours when it fired on phantom processes.

!macro customCheckAppRunning
!macroend
