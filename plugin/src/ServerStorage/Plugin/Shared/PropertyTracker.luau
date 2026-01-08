local InstanceMap = require(script.Parent.InstanceMap)

local selectedInstanceConnection: RBXScriptConnection? = nil
local selectedInstanceAttributeConnection: RBXScriptConnection? = nil
local selectedNodeId: string? = nil
local updateCallback: ((nodeId: string) -> ())? = nil

local function sendPropertyUpdate(nodeId: string)
	if updateCallback then
		updateCallback(nodeId)
	end
end

local function triggerUpdate(nodeId: string?)
	local targetNodeId = nodeId or selectedNodeId
	if targetNodeId then
		sendPropertyUpdate(targetNodeId)
	end
end

local function setupTracking(nodeId: string)
	if selectedInstanceConnection then
		selectedInstanceConnection:Disconnect()
		selectedInstanceConnection = nil
	end

	if selectedInstanceAttributeConnection then
		selectedInstanceAttributeConnection:Disconnect()
		selectedInstanceAttributeConnection = nil
	end

	local instance = InstanceMap[nodeId]
	if not instance then
		return false
	end

	selectedNodeId = nodeId

	selectedInstanceConnection = instance.Changed:Connect(function(propertyName)
		sendPropertyUpdate(nodeId)
	end)

	selectedInstanceAttributeConnection = instance.AttributeChanged:Connect(function()
		sendPropertyUpdate(nodeId)
	end)

	return true
end

local function cleanupTracking()
	if selectedInstanceConnection then
		selectedInstanceConnection:Disconnect()
		selectedInstanceConnection = nil
	end

	if selectedInstanceAttributeConnection then
		selectedInstanceAttributeConnection:Disconnect()
		selectedInstanceAttributeConnection = nil
	end
end

return {
	setupTracking = setupTracking,
	cleanupTracking = cleanupTracking,
	triggerUpdate = triggerUpdate,
	setUpdateCallback = function(callback: (nodeId: string) -> ())
		updateCallback = callback
	end,
}
