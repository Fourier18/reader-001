' Launches Reader.exe with its console window hidden, so it opens like a
' normal app instead of showing a black terminal. Keep this next to Reader.exe.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & scriptDir & "\Reader.exe" & """", 0, False
