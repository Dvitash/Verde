local Icons = require(script.Parent.Icons)

return function(pluginObject)
	local pluginToolbar = pluginObject:CreateToolbar("Verde")
	local connectButton = pluginToolbar:CreateButton("Verde", "Toggle Connection", Icons.DISCONNECTED)
	local settingsButton = pluginToolbar:CreateButton("Settings", "Settings", Icons.SETTINGS)

	connectButton.ClickableWhenViewportHidden = true
	settingsButton.ClickableWhenViewportHidden = true

	return connectButton, settingsButton
end
