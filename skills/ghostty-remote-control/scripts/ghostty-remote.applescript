use scripting additions

on run argv
	if (count of argv) = 0 then return my helpText()

	set commandName to item 1 of argv

	if commandName is "help" then
		return my helpText()
	else if commandName is "ls" then
		return my treeJSON()
	else if commandName is "focused" then
		return my focusedJSON()
	else if commandName is "tree" then
		return my treeJSON()
	else if commandName is "snapshot" then
		return my snapshotJSONForArgs(argv)
	else if commandName is "launch" then
		return my launchFromArgs(argv)
	else if commandName is "focus" then
		my requireArgCount(argv, 2, "focus <focused|terminal-id>")
		return my focusTarget(item 2 of argv)
	else if commandName is "send" then
		my requireArgCount(argv, 3, "send <focused|terminal-id> <text>")
		return my sendToTarget(item 2 of argv, my joinedArgs(argv, 3), false)
	else if commandName is "send-line" then
		my requireArgCount(argv, 3, "send-line <focused|terminal-id> <text>")
		return my sendToTarget(item 2 of argv, my joinedArgs(argv, 3), true)
	else if commandName is "capture-screen" then
		return my captureCommand(argv, "write_screen_file:copy")
	else if commandName is "capture-scrollback" then
		return my captureCommand(argv, "write_scrollback_file:copy")
	else
		error "Unknown command: " & commandName & return & return & my helpText() number 64
	end if
end run

on captureCommand(argv, actionName)
	set targetToken to "focused"
	if (count of argv) > 1 then set targetToken to item 2 of argv
	set termRef to my resolveTerminal(targetToken)
	return my captureFromTerminal(termRef, actionName)
end captureCommand

on requireArgCount(argv, minimumCount, usageText)
	if (count of argv) < minimumCount then error "Usage: " & usageText number 64
end requireArgCount

on joinedArgs(argv, startIndex)
	set outputParts to {}
	repeat with i from startIndex to (count of argv)
		set end of outputParts to item i of argv
	end repeat
	return my joinList(outputParts, " ")
end joinedArgs

on helpText()
	set helpLines to {¬
		"Ghostty AppleScript remote helper", ¬
		"", ¬
		"Usage:", ¬
		"  osascript ghostty-remote.applescript ls", ¬
		"  osascript ghostty-remote.applescript focused", ¬
		"  osascript ghostty-remote.applescript tree", ¬
		"  osascript ghostty-remote.applescript snapshot [focused|terminal-id] [screen|scrollback]", ¬
		"  osascript ghostty-remote.applescript launch kind=<window|tab|split:right|split:down> [target=<focused|terminal-id>] [cwd=/path] [keep_focus=true|false] [command=<command>]", ¬
		"  osascript ghostty-remote.applescript focus <focused|terminal-id>", ¬
		"  osascript ghostty-remote.applescript send <focused|terminal-id> <text>", ¬
		"  osascript ghostty-remote.applescript send-line <focused|terminal-id> <text>", ¬
		"  osascript ghostty-remote.applescript capture-screen [focused|terminal-id]", ¬
		"  osascript ghostty-remote.applescript capture-scrollback [focused|terminal-id]", ¬
		"", ¬
		"Commands returning metadata emit JSON.", ¬
		"Capture commands emit raw terminal text to stdout."}
	return my joinList(helpLines, return)
end helpText

on snapshotJSONForArgs(argv)
	set targetToken to "focused"
	set extentValue to "screen"
	if (count of argv) > 1 then set targetToken to item 2 of argv
	if (count of argv) > 2 then set extentValue to item 3 of argv

	set termRef to my resolveTerminal(targetToken)
	set captureAction to my captureActionForExtent(extentValue)
	set captureText to my captureFromTerminal(termRef, captureAction)

	return "{" & ¬
		"\"ok\":true," & ¬
		"\"extent\":" & my jsonString(extentValue) & "," & ¬
		"\"terminal\":" & my terminalFlatJSON(termRef) & "," & ¬
		"\"text\":" & my jsonString(captureText) & ¬
		"}"
end snapshotJSONForArgs

on captureActionForExtent(extentValue)
	if extentValue is "screen" then return "write_screen_file:copy"
	if extentValue is "scrollback" then return "write_scrollback_file:copy"
	if extentValue is "all" then return "write_scrollback_file:copy"
	error "Unsupported extent: " & extentValue number 64
end captureActionForExtent

on launchFromArgs(argv)
	set kindValue to "split:right"
	set targetToken to "focused"
	set cwdValue to ""
	set keepFocusValue to false
	set commandValue to ""

	repeat with i from 2 to (count of argv)
		set argText to item i of argv
		if argText starts with "kind=" then
			set kindValue to text 6 thru -1 of argText
		else if argText starts with "target=" then
			set targetToken to text 8 thru -1 of argText
		else if argText starts with "cwd=" then
			set cwdValue to text 5 thru -1 of argText
		else if argText starts with "keep_focus=" then
			set keepFocusValue to my parseBooleanText(text 12 thru -1 of argText)
		else if argText starts with "command=" then
			set commandValue to text 9 thru -1 of argText
		else
			error "Unsupported launch argument: " & argText number 64
		end if
	end repeat

	set originalTerm to missing value
	if keepFocusValue or kindValue is not "window" then set originalTerm to my resolveTerminal(targetToken)

	tell application "Ghostty"
		set cfg to new surface configuration
		if cwdValue is not "" then set initial working directory of cfg to cwdValue
		if commandValue is not "" then set command of cfg to commandValue

		if kindValue is "window" then
			set winRef to new window with configuration cfg
			set launchedTerm to focused terminal of selected tab of winRef
		else if kindValue is "tab" then
			set sourceWindow to my windowForTerminal(originalTerm)
			set tabRef to new tab in sourceWindow with configuration cfg
			set launchedTerm to focused terminal of tabRef
		else if kindValue is "split:right" then
			set launchedTerm to split originalTerm direction right with configuration cfg
		else if kindValue is "split:left" then
			set launchedTerm to split originalTerm direction left with configuration cfg
		else if kindValue is "split:down" then
			set launchedTerm to split originalTerm direction down with configuration cfg
		else if kindValue is "split:up" then
			set launchedTerm to split originalTerm direction up with configuration cfg
		else
			error "Unsupported launch kind: " & kindValue number 64
		end if

		if keepFocusValue then focus originalTerm
	end tell

	return "{" & ¬
		"\"ok\":true," & ¬
		"\"action\":" & my jsonString("launch") & "," & ¬
		"\"kind\":" & my jsonString(kindValue) & "," & ¬
		"\"terminal\":" & my terminalFlatJSON(launchedTerm) & ¬
		"}"
end launchFromArgs

on focusedJSON()
	tell application "Ghostty"
		set winRef to front window
		set tabRef to selected tab of winRef
		set termRef to focused terminal of tabRef
		set winId to my textOrEmpty(id of winRef)
		set winName to my textOrEmpty(name of winRef)
		set tabId to my textOrEmpty(id of tabRef)
		set tabName to my textOrEmpty(name of tabRef)
		set tabIndexValue to index of tabRef
	end tell

	return "{" & ¬
		"\"window_id\":" & my jsonString(winId) & "," & ¬
		"\"window_name\":" & my jsonString(winName) & "," & ¬
		"\"tab_id\":" & my jsonString(tabId) & "," & ¬
		"\"tab_name\":" & my jsonString(tabName) & "," & ¬
		"\"tab_index\":" & (tabIndexValue as text) & "," & ¬
		"\"terminal\":" & my terminalFlatJSON(termRef) & ¬
		"}"
end focusedJSON

on treeJSON()
	tell application "Ghostty"
		set frontWindowId to ""
		try
			set frontWindowId to my textOrEmpty(id of front window)
		end try

		set windowPayloads to {}
		repeat with winRef in windows
			set end of windowPayloads to my windowJSON(winRef, frontWindowId)
		end repeat
	end tell

	return "{" & "\"windows\":[" & my joinList(windowPayloads, ",") & "]}"
end treeJSON

on windowJSON(winRef, frontWindowId)
	tell application "Ghostty"
		set winId to my textOrEmpty(id of winRef)
		set winName to my textOrEmpty(name of winRef)
		set selectedTabId to ""
		try
			set selectedTabId to my textOrEmpty(id of selected tab of winRef)
		end try

		set tabPayloads to {}
		repeat with tabRef in tabs of winRef
			set end of tabPayloads to my tabJSON(tabRef, selectedTabId)
		end repeat
	end tell

	return "{" & ¬
		"\"id\":" & my jsonString(winId) & "," & ¬
		"\"name\":" & my jsonString(winName) & "," & ¬
		"\"frontmost\":" & my jsonBool(winId is frontWindowId) & "," & ¬
		"\"tabs\":[" & my joinList(tabPayloads, ",") & "]" & ¬
		"}"
end windowJSON

on tabJSON(tabRef, selectedTabId)
	tell application "Ghostty"
		set tabId to my textOrEmpty(id of tabRef)
		set tabName to my textOrEmpty(name of tabRef)
		set tabIndexValue to index of tabRef
		set focusedTermId to ""
		try
			set focusedTermId to my textOrEmpty(id of focused terminal of tabRef)
		end try

		set terminalPayloads to {}
		repeat with termRef in terminals of tabRef
			set end of terminalPayloads to my terminalJSON(termRef, focusedTermId)
		end repeat
	end tell

	return "{" & ¬
		"\"id\":" & my jsonString(tabId) & "," & ¬
		"\"name\":" & my jsonString(tabName) & "," & ¬
		"\"index\":" & (tabIndexValue as text) & "," & ¬
		"\"selected\":" & my jsonBool(tabId is selectedTabId) & "," & ¬
		"\"terminals\":[" & my joinList(terminalPayloads, ",") & "]" & ¬
		"}"
end tabJSON

on terminalJSON(termRef, focusedTermId)
	set termId to my terminalID(termRef)
	return "{" & ¬
		"\"id\":" & my jsonString(termId) & "," & ¬
		"\"name\":" & my jsonString(my terminalName(termRef)) & "," & ¬
		"\"working_directory\":" & my jsonString(my terminalWorkingDirectory(termRef)) & "," & ¬
		"\"focused\":" & my jsonBool(termId is focusedTermId) & ¬
		"}"
end terminalJSON

on terminalFlatJSON(termRef)
	return "{" & ¬
		"\"id\":" & my jsonString(my terminalID(termRef)) & "," & ¬
		"\"name\":" & my jsonString(my terminalName(termRef)) & "," & ¬
		"\"working_directory\":" & my jsonString(my terminalWorkingDirectory(termRef)) & ¬
		"}"
end terminalFlatJSON

on focusTarget(targetToken)
	set termRef to my resolveTerminal(targetToken)
	tell application "Ghostty"
		focus termRef
	end tell
	return my actionResultJSON("focus", termRef)
end focusTarget

on sendToTarget(targetToken, payload, appendEnter)
	set termRef to my resolveTerminal(targetToken)
	tell application "Ghostty"
		input text payload to termRef
		if appendEnter then send key "enter" to termRef
	end tell
	if appendEnter then
		return my actionResultJSON("send-line", termRef)
	else
		return my actionResultJSON("send", termRef)
	end if
end sendToTarget

on actionResultJSON(actionName, termRef)
	return "{" & ¬
		"\"ok\":true," & ¬
		"\"action\":" & my jsonString(actionName) & "," & ¬
		"\"terminal\":" & my terminalFlatJSON(termRef) & ¬
		"}"
end actionResultJSON

on captureFromTarget(targetToken, actionName)
	set termRef to my resolveTerminal(targetToken)
	return my captureFromTerminal(termRef, actionName)
end captureFromTarget

on captureFromTerminal(termRef, actionName)
	set savedClipboard to missing value
	set clipboardWasSaved to false
	set previousClipboardText to ""
	set captureSentinel to ""
	set sentinelApplied to false
	set clipboardCapture to ""
	set tempPath to ""

	try
		set savedClipboard to the clipboard
		set clipboardWasSaved to true
	on error
		set clipboardWasSaved to false
	end try

	try
		set previousClipboardText to the clipboard as text
	on error
		set previousClipboardText to ""
	end try

	try
		set captureSentinel to my newCaptureSentinel()
		set the clipboard to captureSentinel
		set sentinelApplied to true
	on error
		set sentinelApplied to false
	end try

	try
		tell application "Ghostty"
			perform action actionName on termRef
		end tell

		set clipboardCapture to my waitForCaptureClipboard(previousClipboardText, captureSentinel, sentinelApplied)
		if clipboardCapture is "" then
			error "Ghostty did not emit capture data. If this terminal is in an alternate-screen TUI, try capture-screen instead." number 1
		end if

		if my readableFileExists(clipboardCapture) then
			set tempPath to clipboardCapture
			set captureText to do shell script "/bin/cat " & quoted form of tempPath
			try
				do shell script "/bin/rm -f " & quoted form of tempPath
			end try
		else
			set captureText to clipboardCapture
		end if
	on error errMsg number errNum
		if tempPath is not "" then
			try
				do shell script "/bin/rm -f " & quoted form of tempPath
			end try
		end if
		my restoreClipboard(savedClipboard, clipboardWasSaved)
		error errMsg number errNum
	end try

	my restoreClipboard(savedClipboard, clipboardWasSaved)
	return captureText
end captureFromTerminal

on waitForCaptureClipboard(previousClipboardText, captureSentinel, sentinelApplied)
	repeat 20 times
		delay 0.1
		try
			set candidateValue to the clipboard as text
		on error
			set candidateValue to ""
		end try

		if sentinelApplied then
			if candidateValue is not "" and candidateValue is not captureSentinel then return candidateValue
		else
			if candidateValue is not "" and candidateValue is not previousClipboardText then return candidateValue
		end if
	end repeat

	return ""
end waitForCaptureClipboard

on newCaptureSentinel()
	return "__ghostty_capture__" & do shell script "/usr/bin/uuidgen"
end newCaptureSentinel

on readableFileExists(pathText)
	try
		do shell script "/bin/test -r " & quoted form of pathText
		return true
	on error
		return false
	end try
end readableFileExists

on restoreClipboard(savedClipboard, clipboardWasSaved)
	if clipboardWasSaved then
		try
			set the clipboard to savedClipboard
		end try
	end if
end restoreClipboard

on resolveTerminal(targetToken)
	tell application "Ghostty"
		if targetToken is "focused" then
			return focused terminal of selected tab of front window
		end if

		set matches to every terminal whose id is targetToken
		if (count of matches) is 0 then error "No Ghostty terminal found with id " & targetToken number 1
		return item 1 of matches
	end tell
end resolveTerminal

on windowForTerminal(termRef)
	set targetId to my terminalID(termRef)
	tell application "Ghostty"
		repeat with winRef in windows
			repeat with tabRef in tabs of winRef
				repeat with candidateTerm in terminals of tabRef
					if my textOrEmpty(id of candidateTerm) is targetId then return winRef
				end repeat
			end repeat
		end repeat
		end tell
	error "No Ghostty window found for terminal id " & targetId number 1
end windowForTerminal

on parseBooleanText(boolText)
	if boolText is "1" then return true
	if boolText is "true" then return true
	if boolText is "yes" then return true
	if boolText is "on" then return true
	return false
end parseBooleanText

on terminalID(termRef)
	tell application "Ghostty"
		return my textOrEmpty(id of termRef)
	end tell
end terminalID

on terminalName(termRef)
	tell application "Ghostty"
		return my textOrEmpty(name of termRef)
	end tell
end terminalName

on terminalWorkingDirectory(termRef)
	tell application "Ghostty"
		return my textOrEmpty(working directory of termRef)
	end tell
end terminalWorkingDirectory

on textOrEmpty(valueRef)
	if valueRef is missing value then return ""
	try
		return valueRef as text
	on error
		return ""
	end try
end textOrEmpty

on jsonBool(boolValue)
	if boolValue then return "true"
	return "false"
end jsonBool

on jsonString(rawText)
	return "\"" & my jsonEscape(rawText) & "\""
end jsonString

on jsonEscape(rawText)
	set escapedText to my replaceText("\\", "\\\\", rawText)
	set escapedText to my replaceText("\"", "\\\"", escapedText)
	repeat with controlCode from 0 to 31
		set escapedText to my replaceText(character id controlCode, my jsonControlEscape(controlCode), escapedText)
	end repeat
	return escapedText
end jsonEscape

on jsonControlEscape(controlCode)
	if controlCode is 8 then return "\\b"
	if controlCode is 9 then return "\\t"
	if controlCode is 10 then return "\\n"
	if controlCode is 12 then return "\\f"
	if controlCode is 13 then return "\\r"
	return "\\u00" & my hexByte(controlCode)
end jsonControlEscape

on hexByte(numberValue)
	set hexDigits to "0123456789ABCDEF"
	set highNibble to (numberValue div 16) + 1
	set lowNibble to (numberValue mod 16) + 1
	return character highNibble of hexDigits & character lowNibble of hexDigits
end hexByte

on replaceText(findText, replaceWith, sourceText)
	set AppleScript's text item delimiters to findText
	set sourceItems to text items of sourceText
	set AppleScript's text item delimiters to replaceWith
	set newText to sourceItems as text
	set AppleScript's text item delimiters to ""
	return newText
end replaceText

on joinList(valueList, delimiterText)
	if (count of valueList) is 0 then return ""
	set AppleScript's text item delimiters to delimiterText
	set joinedText to valueList as text
	set AppleScript's text item delimiters to ""
	return joinedText
end joinList
