--!strict
--[=[
	@class Filter

	A list of various filters that can be used to filter out API
	members from the dump. This is useful for filtering members, such
	as those that are deprecated or inaccessible to non-CoreScripts.
]=]
local T = require(script.Parent["init.d"])
local NONE = require(script.Parent.Util.None)

local VALUE_TYPE_REMAP = {
	boolean = { "bool" },
	number = { "float", "double", "int", "int64" },
	string = { "string" },
	[NONE] = { "void" },
}

--[=[
	@interface SecurityLevels
	@within Filter
	.Read (string | { string })?
	.Write (string | { string })?
]=]
type SecurityLevels = {
	Read: (string | { string })?,
	Write: (string | { string })?,
}

--[=[
	@function HasTags
	@within Filter
	@param ... string
	@return GenericFilter<Item>

	Checks if the given [Item] has any of the given tags. If multiple
	tags are given, then the [Item] must have all of the tags in order
	to pass the filter.
]=]
local function HasTags(...: string): T.GenericFilter<T.Item>
	local tags = { ... }

	return function(object: T.Item)
		if object.Tags == nil then
			return false
		end

		local matchCount = 0

		for _, tag in tags do
			if table.find(object.Tags, tag) ~= nil then
				matchCount += 1
			end
		end

		return matchCount == #tags
	end
end

--[=[
	@function HasSecurity
	@within Filter
	@param levels SecurityLevels | string
	@return GenericFilter<Item>

	Accepts a [SecurityLevels] object or a string. If a string is passed,
	both Read and Write will be set to that string. [SecurityLevels] can
	also accept an array of strings for Read and Write, which will be
	used as an `OR` condition, meaning that the object will be accepted
	if it matches any of the strings in the array.

	This filter *can* also be used on [Items] whose `Security` field is
	a string, such as [Function]s.
]=]
local function HasSecurity(levels: SecurityLevels | string): T.GenericFilter<T.Item>
	if type(levels) == "string" then
		levels = { Read = levels, Write = levels }
	end

	return function(object: T.Item)
		if object.Security == nil then
			return false
		end

		if typeof(object.Security) == "string" then
			return levels.Read == object.Security or levels.Write == object.Security
		end

		local read = typeof(levels.Read) == "string" and { levels.Read } or levels.Read
		local write = typeof(levels.Write) == "string" and { levels.Write } or levels.Write

		return table.find(read, object.Security.Read) ~= nil
			and table.find(write, object.Security.Write) ~= nil
	end
end

--[=[
	@function Invert
	@within Filter
	@param filter GenericFilter<Item>
	@return GenericFilter<Item>

	Inverts the given filter. If the filter returns `true`, then this
	filter will return `false`, and vice versa. For example:

	```lua
	local NonDeprecated = Filter.Invert(Filter.Deprecated)
	```
]=]
local function Invert(filter: T.GenericFilter<T.Item>): T.GenericFilter<T.Item>
	return function(...)
		return not filter(...)
	end
end

--[=[
	@prop Deprecated GenericFilter<Item>
	@within Filter
]=]
local Deprecated: T.GenericFilter<T.Item> = function(object)
	return HasTags("Deprecated")(object)
end

--[=[
	@prop ReadOnly GenericFilter<Item>
	@within Filter
]=]
local ReadOnly: T.GenericFilter<T.Item> = function(object)
	return HasTags("ReadOnly")(object)
end

--[=[
	@prop Replicated GenericFilter<Item>
	@within Filter
]=]
local Replicated: T.GenericFilter<T.Item> = Invert(HasTags("NotReplicated"))

--[=[
	@prop Scriptable GenericFilter<Item>
	@within Filter
]=]
local Scriptable: T.GenericFilter<T.Item> = Invert(HasTags("NotScriptable"))

--[=[
	@prop Yields GenericFilter<Item>
	@within Filter
]=]
local Yields: T.GenericFilter<T.Item> = function(object)
	return HasTags("Yields")(object)
end

--[=[
	@prop ThreadSafe GenericFilter<Item>
	@within Filter
]=]
local ThreadSafe: T.GenericFilter<T.Item> = function(object)
	return object.ThreadSafety == "ThreadSafe"
end

--[=[
	@prop Readable GenericFilter<Item>
	@within Filter
]=]
local Readable: T.GenericFilter<T.Item> = function(object)
	return HasSecurity({ Read = "None" })(object)
end

--[=[
	@prop Writable GenericFilter<Item>
	@within Filter
]=]
local Writable: T.GenericFilter<T.Item> = function(object)
	return HasSecurity({ Write = "None" })(object)
end

--[=[
	@prop Service GenericFilter<Item>
	@within Filter
]=]
local Service: T.GenericFilter<T.Item> = function(object)
	return object.Tags ~= nil and table.find(object.Tags, "Service") ~= nil
end

--[=[
	@function MemberType
	@within Filter
	@param memberType string
	@return GenericFilter<Item>

	Checks if the given [Item] is of the given member type; for example,
	when trying to access only members which are of type `"Property"`.
]=]
local function MemberType(memberType: string): T.GenericFilter<T.Item>
	return function(object: T.Item)
		return object.MemberType == memberType
	end
end

--[=[
	@function Name
	@within Filter
	@param name string
	@return GenericFilter<Item>

	Checks if the given [Item]'s name matches the given string.
]=]
local function Name(name: string): T.GenericFilter<T.Item>
	return function(object: T.Item)
		return object.Name == name
	end
end

--[=[
	@function Any
	@within Filter
	@param ... GenericFilter<Item>
	@return GenericFilter<Item>

	Combines multiple filters into a single filter. The returned filter
	will return `true` if *any* of the given filters return `true`. If
	no filters are given, then the returned filter will always return
	`true`, but will print a warning to the output.
]=]
local function Any(...: T.GenericFilter<T.Item>): T.GenericFilter<T.Item>
	if select("#", ...) == 0 then
		warn("Filter.Any was called with no filters")

		return function(_: T.Item): true
			return true
		end
	end

	local filters = { ... }

	return function(object: T.Item)
		for _, filter in filters do
			if filter(object) then
				return true
			end
		end

		return false
	end
end

--[=[
	@function ValueType
	@within Filter
	@param type string | nil
	@return GenericFilter<Item>

	Returns `true` for any [Item] whose `ValueType` field is of the given type.
	Primitive Luau types, such as `string` or `number` can be used; they will
	automatically be mapped to the corresponding `ValueType` string (e.g.
	`number` can refer to `float`, `double`, `int`, etc.).
]=]
local function ValueType(type: string | nil): T.GenericFilter<T.Item>
	return function(object: T.Item)
		local valueType = object.ValueType

		if not valueType then
			return false
		end

		if valueType.Category == "Primitive" then
			local primitiveRemap = if type == nil
				then VALUE_TYPE_REMAP[NONE]
				else VALUE_TYPE_REMAP[type]

			if not primitiveRemap then
				return valueType.Name == type
			end

			return table.find(primitiveRemap, valueType.Name) ~= nil
		end

		return valueType.Name == type
	end
end

return {
	Any = Any,
	Deprecated = Deprecated,
	HasSecurity = HasSecurity,
	HasTags = HasTags,
	Invert = Invert,
	MemberType = MemberType,
	Name = Name,
	Readable = Readable,
	ReadOnly = ReadOnly,
	Replicated = Replicated,
	Scriptable = Scriptable,
	Service = Service,
	ThreadSafe = ThreadSafe,
	ValueType = ValueType,
	Writable = Writable,
	Yields = Yields,
}
