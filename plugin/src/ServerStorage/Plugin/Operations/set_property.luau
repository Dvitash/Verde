local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)
local getProperties = require(script.Parent.get_properties)
local print = require(script.Parent.Parent.Utils.print)

return function(operation)
	local nodeId = operation.nodeId
	local propertyName = operation.propertyName
	local propertyValue = operation.propertyValue

	local instance = InstanceMap[nodeId]

	if not instance then
		return false
	end

	local errorMessage = nil
	local success, result = pcall(function()
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
			elseif typeof(propertyValue.X) == "number" and typeof(propertyValue.Y) == "number" then
				instance[propertyName] = Vector2.new(propertyValue.X, propertyValue.Y)
			end
		elseif typeof(propertyValue) == "table" and propertyValue.Scale ~= nil and propertyValue.Offset ~= nil then
			instance[propertyName] = UDim.new(propertyValue.Scale, propertyValue.Offset)
		elseif typeof(propertyValue) == "table" and propertyValue.Position ~= nil and propertyValue.Rotation ~= nil then
			local pos = propertyValue.Position
			local rot = propertyValue.Rotation
			if pos.X and pos.Y and pos.Z then
				instance[propertyName] = CFrame.new(pos.X, pos.Y, pos.Z)
					* CFrame.Angles(rot.X or 0, rot.Y or 0, rot.Z or 0)
			end
		elseif
			typeof(propertyValue) == "table"
			and propertyValue.R ~= nil
			and propertyValue.G ~= nil
			and propertyValue.B ~= nil
		then
			instance[propertyName] = Color3.new(propertyValue.R, propertyValue.G, propertyValue.B)
		elseif typeof(propertyValue) == "table" and propertyValue.Min ~= nil and propertyValue.Max ~= nil then
			instance[propertyName] = NumberRange.new(propertyValue.Min, propertyValue.Max)
		elseif typeof(propertyValue) == "table" and propertyValue.Keypoints ~= nil then
			local keypoints = {}
			local isColorSequence = false

			for _, kp in propertyValue.Keypoints do
				if
					kp.Value
					and typeof(kp.Value) == "table"
					and kp.Value.R ~= nil
					and kp.Value.G ~= nil
					and kp.Value.B ~= nil
				then
					isColorSequence = true
					local color = Color3.new(kp.Value.R, kp.Value.G, kp.Value.B)
					table.insert(keypoints, ColorSequenceKeypoint.new(kp.Time or 0, color))
				else
					local value = kp.Value
					if typeof(value) == "table" then
						value = value.Value or value.v or 0
					end
					local time = kp.Time or 0
					local keypoint = NumberSequenceKeypoint.new(time, value or 0)
					table.insert(keypoints, keypoint)
				end
			end

			if #keypoints > 0 then
				table.sort(keypoints, function(a, b)
					return a.Time < b.Time
				end)

				if isColorSequence then
					instance[propertyName] = ColorSequence.new(keypoints)
				else
					instance[propertyName] = NumberSequence.new(keypoints)
				end
			else
				error("No keypoints provided for sequence")
			end
		else
			instance[propertyName] = propertyValue
		end
	end)

	if not success then
		errorMessage = tostring(result)
		print("set_property failed for", propertyName, ":", errorMessage)
		return false, errorMessage
	end

	local propertiesResult = getProperties({ nodeId = operation.nodeId })
	if propertiesResult then
		return propertiesResult
	else
		return false, "Failed to get updated properties"
	end
end
