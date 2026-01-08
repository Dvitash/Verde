local Icons = require(script.Parent.Icons)

return function(pluginObject)
	local pluginToolbar = pluginObject:CreateToolbar("Verde")
	local button = pluginToolbar:CreateButton("Verde", "Toggle Connection", Icons.DISCONNECTED)

	return button
end
