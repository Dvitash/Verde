local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)
local NameUtils = require(script.Parent.Parent.Utils.name)
local error = require(script.Parent.Parent.Utils.error)

return function(payload: { nodeId: string }): boolean
	local nodeId = payload.nodeId

	local instance = InstanceMap[nodeId]

	if not instance then
		error("instance not found: " .. nodeId)
	end

	local clonedInstance = instance:Clone()
	clonedInstance.Parent = instance.Parent

	local baseName, _ = NameUtils.ParseName(instance.Name)
	local newName = NameUtils.GetValidName(instance.Parent, baseName)

	clonedInstance.Name = newName

	return true
end
