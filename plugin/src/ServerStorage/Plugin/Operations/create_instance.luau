local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)
local NameUtils = require(script.Parent.Parent.Utils.name)
local error = require(script.Parent.Parent.Utils.error)

return function(payload: { parentId: string, className: string }): boolean
	local parentId = payload.parentId
	local className = payload.className

	local parent = InstanceMap[parentId]

	if not parent then
		error("parent not found: " .. parentId)
	end

	if type(className) ~= "string" or className == "" then
		error("invalid className")
	end

	local newInstance = Instance.new(className)

	if not newInstance then
		error("failed to create instance of class: " .. className)
	end

	local newName = NameUtils.GetValidName(parent, className)
	newInstance.Name = newName
	newInstance.Parent = parent

	local newId = newInstance:GetDebugId(0)
	InstanceMap[newId] = newInstance

	return newId
end
