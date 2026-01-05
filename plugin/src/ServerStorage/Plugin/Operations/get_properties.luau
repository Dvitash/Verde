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

	return safeProperties
end
