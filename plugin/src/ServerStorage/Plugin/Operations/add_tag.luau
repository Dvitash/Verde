local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)
local PropertyTracker = require(script.Parent.Parent.Shared.PropertyTracker)

return function(operation)
	local nodeId = operation.nodeId
	local tagName = operation.tagName

	local instance = InstanceMap[nodeId]

	if not instance then
		return false, "Instance not found"
	end

	if not tagName or tagName == "" then
		return false, "Tag name is required"
	end

	instance:AddTag(tagName)
	PropertyTracker.triggerUpdate(nodeId)

	return true
end
