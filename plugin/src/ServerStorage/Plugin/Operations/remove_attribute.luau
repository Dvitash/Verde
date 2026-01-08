local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

return function(operation)
	local nodeId = operation.nodeId
	local attributeName = operation.attributeName

	local instance = InstanceMap[nodeId]

	if not instance then
		return false, "Instance not found"
	end

	if not attributeName or attributeName == "" then
		return false, "Attribute name is required"
	end

	instance:SetAttribute(attributeName, nil)

	return true
end
