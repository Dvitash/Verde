local PropertyTracker = require(script.Parent.Parent.Shared.PropertyTracker)
local Filter = require(script.Parent.Parent.Packages.DumpParser.Filter)
local DumpParser = require(script.Parent.Parent.Packages.DumpParser)
local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

local Dump = DumpParser.fetchFromServer()

local UNSAFE_PROPERTIES = {
	Parent = true,
	ClassName = true,
	Disabled = true,
}

return function(operation)
	local nodeId = operation.nodeId
	local instance = InstanceMap[nodeId]

	if not instance then
		return false
	end

	local className = instance.ClassName
	local class = Dump:GetClass(className)

	if not class then
		return false
	end

	local properties =
		class:GetProperties(Filter.Invert(Filter.Deprecated), Filter.HasSecurity("None"), Filter.Scriptable)

	local safeProperties = {}
	for propertyName, property in properties do
		if UNSAFE_PROPERTIES[propertyName] then
			continue
		end

		local propType = property.ValueType and property.ValueType.Name or "Unknown"
		local propValue = instance[property.Name]

		-- Handle enum values specially
		if property.ValueType and property.ValueType.Category == "Enum" and typeof(propValue) == "EnumItem" then
			propValue = {
				Value = propValue.Value,
				Name = propValue.Name,
			}
		end

		if typeof(propValue) == "CFrame" then
			propValue = {
				Position = {
					X = math.round(propValue.Position.X * 1000) / 1000,
					Y = math.round(propValue.Position.Y * 1000) / 1000,
					Z = math.round(propValue.Position.Z * 1000) / 1000,
				},
				Rotation = {
					X = propValue.LookVector.X,
					Y = propValue.LookVector.Y,
					Z = propValue.LookVector.Z,
				},
			}
		elseif typeof(propValue) == "Vector3" then
			propValue = {
				X = math.round(propValue.X * 1000) / 1000,
				Y = math.round(propValue.Y * 1000) / 1000,
				Z = math.round(propValue.Z * 1000) / 1000,
			}
		elseif typeof(propValue) == "Vector2" then
			propValue = {
				X = propValue.X,
				Y = propValue.Y,
			}
		elseif typeof(propValue) == "UDim2" then
			propValue = {
				X = {
					Scale = propValue.X.Scale,
					Offset = propValue.X.Offset,
				},
				Y = {
					Scale = propValue.Y.Scale,
					Offset = propValue.Y.Offset,
				},
			}
		elseif typeof(propValue) == "UDim" then
			propValue = {
				Scale = propValue.Scale,
				Offset = propValue.Offset,
			}
		elseif typeof(propValue) == "Color3" then
			propValue = {
				R = propValue.R,
				G = propValue.G,
				B = propValue.B,
			}
		elseif typeof(propValue) == "BrickColor" then
			propValue = {
				R = propValue.Color.R,
				G = propValue.Color.G,
				B = propValue.Color.B,
				Name = propValue.Name,
				Number = propValue.Number,
			}
		elseif typeof(propValue) == "NumberRange" then
			propValue = {
				Min = propValue.Min,
				Max = propValue.Max,
			}
		elseif typeof(propValue) == "NumberSequence" then
			local keypoints = {}
			for _, keypoint in propValue.Keypoints do
				table.insert(keypoints, {
					Time = keypoint.Time,
					Value = keypoint.Value,
				})
			end
			propValue = {
				Keypoints = keypoints,
			}
		elseif typeof(propValue) == "ColorSequence" then
			local keypoints = {}
			for _, keypoint in propValue.Keypoints do
				local value = keypoint.Value
				if typeof(value) == "Color3" then
					table.insert(keypoints, {
						Time = keypoint.Time,
						Value = {
							R = value.R,
							G = value.G,
							B = value.B,
						},
					})
				else
					table.insert(keypoints, {
						Time = keypoint.Time,
						Value = value,
					})
				end
			end
			propValue = {
				Keypoints = keypoints,
			}
		end

		local enumValues = nil

		if property.ValueType and property.ValueType.Category == "Enum" then
			local success, enumTable = pcall(function()
				return Enum[propType]
			end)

			if success and enumTable then
				enumValues = {}
				for _, enumItem in enumTable:GetEnumItems() do
					table.insert(enumValues, {
						name = enumItem.Name,
						value = enumItem.Value,
					})
				end
			end
		end

		local referencedInstanceId = nil
		local referencedInstanceName = nil
		local referencedInstanceClass = nil
		if typeof(propValue) == "Instance" then
			for id, inst in InstanceMap do
				if inst == propValue then
					referencedInstanceId = id
					referencedInstanceName = inst.Name
					referencedInstanceClass = inst.ClassName
					break
				end
			end
		end

		table.insert(safeProperties, {
			name = property.Name,
			type = propType,
			value = propValue,
			category = property.Category or "Other",
			isEnum = property.ValueType and property.ValueType.Category == "Enum" or false,
			enumValues = enumValues,
			isInstanceReference = typeof(propValue) == "Instance",
			referencedInstanceId = referencedInstanceId,
			referencedInstanceName = referencedInstanceName,
			referencedInstanceClass = referencedInstanceClass,
		})
	end

	local tags = instance:GetTags()

	local attributes = {}
	local success, attributesTable = pcall(function()
		return instance:GetAttributes()
	end)
	if success and attributesTable then
		for attrName, attrValue in attributesTable do
			local attrType = typeof(attrValue)
			local serializedValue = attrValue

			if typeof(attrValue) == "Color3" then
				serializedValue = {
					R = attrValue.R,
					G = attrValue.G,
					B = attrValue.B,
				}
			elseif typeof(attrValue) == "Vector3" then
				serializedValue = {
					X = math.round(attrValue.X * 1000) / 1000,
					Y = math.round(attrValue.Y * 1000) / 1000,
					Z = math.round(attrValue.Z * 1000) / 1000,
				}
			elseif typeof(attrValue) == "Vector2" then
				serializedValue = {
					X = attrValue.X,
					Y = attrValue.Y,
				}
			elseif typeof(attrValue) == "UDim2" then
				serializedValue = {
					X = {
						Scale = attrValue.X.Scale,
						Offset = attrValue.X.Offset,
					},
					Y = {
						Scale = attrValue.Y.Scale,
						Offset = attrValue.Y.Offset,
					},
				}
			elseif typeof(attrValue) == "UDim" then
				serializedValue = {
					Scale = attrValue.Scale,
					Offset = attrValue.Offset,
				}
			elseif typeof(attrValue) == "BrickColor" then
				serializedValue = {
					R = attrValue.Color.R,
					G = attrValue.Color.G,
					B = attrValue.Color.B,
					Name = attrValue.Name,
					Number = attrValue.Number,
				}
			elseif typeof(attrValue) == "NumberRange" then
				serializedValue = {
					Min = attrValue.Min,
					Max = attrValue.Max,
				}
			end

			table.insert(attributes, {
				name = attrName,
				type = attrType,
				value = serializedValue,
			})
		end
	end

	local result = {
		properties = safeProperties,
		tags = tags,
		attributes = attributes,
	}

	PropertyTracker.setupTracking(nodeId)

	return result
end
