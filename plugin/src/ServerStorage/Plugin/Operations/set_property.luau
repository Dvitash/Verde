local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

return function(operation)
	local nodeId = operation.nodeId
	local propertyName = operation.propertyName
	local propertyValue = operation.propertyValue

	local instance = InstanceMap[nodeId]

	if not instance then
		return false
	end

	local success = pcall(function()
		if typeof(propertyValue) == "table" and propertyValue.EnumName and propertyValue.EnumType then
			local enumType = Enum[propertyValue.EnumType]
			if enumType then
				local enumItem = enumType[propertyValue.EnumName]
				if enumItem then
					instance[propertyName] = enumItem
					return
				end
			end
			error("Invalid enum value: " .. propertyValue.EnumType .. "." .. propertyValue.EnumName)
		elseif
			typeof(propertyValue) == "table"
			and propertyValue.X ~= nil
			and propertyValue.Y ~= nil
			and propertyValue.Z ~= nil
		then
			instance[propertyName] = Vector3.new(propertyValue.X, propertyValue.Y, propertyValue.Z)
		elseif typeof(propertyValue) == "table" and propertyValue.X ~= nil and propertyValue.Y ~= nil then
			if typeof(propertyValue.X) == "table" and typeof(propertyValue.Y) == "table" then
				instance[propertyName] = UDim2.new(
					propertyValue.X.Scale or 0,
					propertyValue.X.Offset or 0,
					propertyValue.Y.Scale or 0,
					propertyValue.Y.Offset or 0
				)
			end
		elseif
			typeof(propertyValue) == "table"
			and propertyValue.R ~= nil
			and propertyValue.G ~= nil
			and propertyValue.B ~= nil
		then
			-- Handle Color3
			instance[propertyName] = Color3.new(propertyValue.R, propertyValue.G, propertyValue.B)
		else
			-- Handle other values normally
			instance[propertyName] = propertyValue
		end
	end)

	return success
end
