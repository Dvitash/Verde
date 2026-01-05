--!strict
local function truthy()
	return true
end

local function filter<T>(
	array: { T },
	predicate: ((value: T, index: number, array: { T }) -> boolean?)?
): { T }
	local result = {}

	predicate = if type(predicate) == "function" then predicate else truthy

	for index, value in ipairs(array) do
		if predicate(value, index, array) then
			table.insert(result, value)
		end
	end

	return result
end

local function map<T, U>(array: { T }, mapper: (value: T, index: number, array: { T }) -> U?): { U }
	local mapped = {}

	for index, value in ipairs(array) do
		local mappedValue = mapper(value, index, array)

		if mappedValue ~= nil then
			table.insert(mapped, mappedValue)
		end
	end

	return mapped
end

return {
	filter = filter,
	map = map,
}
