local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

return function(operation)
	local nodeId = operation.nodeId
	local attributeName = operation.attributeName
	local attributeType = operation.attributeType

	local instance = InstanceMap[nodeId]

	if not instance then
		return false, "Instance not found"
	end

	if not attributeName or attributeName == "" then
		return false, "Attribute name is required"
	end

	if not attributeType or attributeType == "" then
		return false, "Attribute type is required"
	end

	local defaultValue
	if attributeType == "string" then
		defaultValue = ""
	elseif attributeType == "number" then
		defaultValue = 0
	elseif attributeType == "boolean" then
		defaultValue = false
	elseif attributeType == "Color3" then
		defaultValue = Color3.new(1, 1, 1)
	elseif attributeType == "Vector2" then
		defaultValue = Vector2.new(0, 0)
	elseif attributeType == "Vector3" then
		defaultValue = Vector3.new(0, 0, 0)
	elseif attributeType == "UDim" then
		defaultValue = UDim.new(0, 0)
	elseif attributeType == "UDim2" then
		defaultValue = UDim2.new(0, 0, 0, 0)
	elseif attributeType == "BrickColor" then
		defaultValue = BrickColor.new("White")
	elseif attributeType == "NumberRange" then
		defaultValue = NumberRange.new(0, 0)
	elseif attributeType == "NumberSequence" then
		defaultValue = NumberSequence.new(0)
	elseif attributeType == "ColorSequence" then
		defaultValue = ColorSequence.new(Color3.new(1, 1, 1))
	else
		return false, "Unknown attribute type: " .. attributeType
	end

	local success, err = pcall(function()
		instance:SetAttribute(attributeName, defaultValue)
	end)

	if not success then
		return false, tostring(err)
	end

	return true
end
