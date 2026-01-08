local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

return function(operation)
	local nodeId = operation.nodeId
	local attributeName = operation.attributeName
	local attributeValue = operation.attributeValue

	local instance = InstanceMap[nodeId]

	if not instance then
		return false, "Instance not found"
	end

	if not attributeName or attributeName == "" then
		return false, "Attribute name is required"
	end

	local success, err = pcall(function()
		if
			typeof(attributeValue) == "table"
			and attributeValue.X ~= nil
			and attributeValue.Y ~= nil
			and attributeValue.Z ~= nil
		then
			instance:SetAttribute(attributeName, Vector3.new(attributeValue.X, attributeValue.Y, attributeValue.Z))
		elseif typeof(attributeValue) == "table" and attributeValue.X ~= nil and attributeValue.Y ~= nil then
			if typeof(attributeValue.X) == "table" and typeof(attributeValue.Y) == "table" then
				instance:SetAttribute(
					attributeName,
					UDim2.new(
						attributeValue.X.Scale or 0,
						attributeValue.X.Offset or 0,
						attributeValue.Y.Scale or 0,
						attributeValue.Y.Offset or 0
					)
				)
			elseif typeof(attributeValue.X) == "number" and typeof(attributeValue.Y) == "number" then
				instance:SetAttribute(attributeName, Vector2.new(attributeValue.X, attributeValue.Y))
			end
		elseif typeof(attributeValue) == "table" and attributeValue.Scale ~= nil and attributeValue.Offset ~= nil then
			instance:SetAttribute(attributeName, UDim.new(attributeValue.Scale, attributeValue.Offset))
		elseif
			typeof(attributeValue) == "table"
			and attributeValue.R ~= nil
			and attributeValue.G ~= nil
			and attributeValue.B ~= nil
		then
			instance:SetAttribute(attributeName, Color3.new(attributeValue.R, attributeValue.G, attributeValue.B))
		elseif typeof(attributeValue) == "table" and attributeValue.Min ~= nil and attributeValue.Max ~= nil then
			instance:SetAttribute(attributeName, NumberRange.new(attributeValue.Min, attributeValue.Max))
		else
			instance:SetAttribute(attributeName, attributeValue)
		end
	end)

	if not success then
		return false, tostring(err)
	end

	return true
end
