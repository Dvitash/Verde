--!strict
--[=[
  @class Class

  Represents a Class within the API dump.
]=]
local T = require(script.Parent["init.d"])

local Array = require(script.Parent.Util.Array)
local Filter = require(script.Parent.Filter)

local CLASS_CACHE = {}
local Class = {}

Class.__index = Class

local ERR_FILTER_INVALID = 'Invalid filter; expected string | GenericFilter, got "%*" (%s)'

--[=[
  @function new
  @within Class
  @param classEntry Class
  @return Class

  Creates a new Class instance from the given class entry.
  Classes are cached, so if a class with the same name has
  already been constructed, it will return that instead.
]=]
function Class.new(classEntry: T.Class)
	if CLASS_CACHE[classEntry.Name] then
		return CLASS_CACHE[classEntry.Name]
	end

	local self = setmetatable({}, Class)
	CLASS_CACHE[classEntry.Name] = self

--- @prop Name string
--- @within Class
	self.Name = classEntry.Name

--- @prop Superclass string
--- @within Class
	self.Superclass = classEntry.Superclass

--- @prop Members { Member }
--- @within Class
	self.Members = classEntry.Members

--- @prop Tags { string }?
--- @within Class
	self.Tags = classEntry.Tags

--- @prop Inherits { string }
--- @within Class
	self.Inherits = classEntry.Inherits

	return table.freeze(self)
end

--[=[
	@method filterMembers<T>
	@within Class
	@private
	@param filter { string | GenericFilter<T> }
	@return { [string]: T }

	Accepts a table of filters, and returns a table of members that
	passed the filter. The keys of the table are the member names,
	and the values are the members themselves.
]=]
function Class:filterMembers<T>(filters: { string | T.GenericFilter<T> })
	local initialFilter = table.remove(filters, 1)
	local filteredResults: { T } = Array.filter(self.Members, initialFilter)

	if #filters > 0 then
		filters = Array.map(filters, function(filter)
			local filterType = typeof(filter)

			if filterType == "function" then
				return filter
			elseif filterType == "string" then
				return Filter.Name(filter)
			end

			error(ERR_FILTER_INVALID:format(filter, filterType))
		end)

		for _, filter in filters do
			filteredResults = Array.filter(filteredResults, filter)
		end
	end

	local results: { [string]: T } = {}

	for _, result in filteredResults do
		results[result.Name] = result
	end

	return results
end

--[=[
	@method GetProperties
	@within Class
	@param ... (string | GenericFilter<Property>)?
	@return { [string]: Property }

	Returns a table of all properties that match the given
	filters. A filter may be a string (property name), or
	a table of filters.

	A property must match all of the given filters in order to
	pass. If no filters are given, all properties are returned.

	The resulting table is a dictionary of properties, where
	the key is the property name and the value is the property
	object from the API dump.
]=]
function Class:GetProperties(...: (string | T.GenericFilter<T.Property>)?)
	local results: { [string]: T.Property } =
		self:filterMembers({ Filter.MemberType("Property"), ... })

	return results
end

--[=[
	@method GetProperty
	@within Class
	@param name string
	@return Property?

	Returns the property with the given name, or nil if it
	does not exist.
]=]
function Class:GetProperty(name: string): T.Property?
	return self:GetProperties(name)[name]
end

--[=[
	@method GetEvents
	@within Class
	@param ... (string | GenericFilter<Event>)?
	@return { [string]: Event }

	Returns a table of all events that match the given
	filters. A filter may be a string (event name), or
	a table of filters.
]=]
function Class:GetEvents(...: (string | T.GenericFilter<T.Event>)?)
	local results: { [string]: T.Event } = self:filterMembers({ Filter.MemberType("Event"), ... })

	return results
end

--[=[
	@method GetEvent
	@within Class
	@param name string
	@return Event?

	Returns the event with the given name, or nil if it
	does not exist.
]=]
function Class:GetEvent(name: string): T.Event?
	return self:GetEvents(name)[name]
end

--[=[
	@method GetFunctions
	@within Class
	@param ... (string | GenericFilter<Function>)?
	@return { [string]: Function }

	Returns a table of all functions that match the given
	filters. A filter may be a string (function name), or
	a table of filters.
]=]
function Class:GetFunctions(...: (string | T.GenericFilter<T.Function>)?)
	local results: { [string]: T.Function } =
		self:filterMembers({ Filter.MemberType("Function"), ... })

	return results
end

--[=[
	@method GetFunction
	@within Class
	@param name string
	@return Function?

	Returns the function with the given name, or nil if it
	does not exist.
]=]
function Class:GetFunction(name: string): T.Function?
	return self:GetFunctions(name)[name]
end

--[=[
	@method GetCallbacks
	@within Class
	@param ... (string | GenericFilter<Callback>)?
	@return { [string]: Callback }

	Returns a table of all callbacks that match the given
	filters. A filter may be a string (callback name), or
	a table of filters.
]=]
function Class:GetCallbacks(...: (string | T.GenericFilter<T.Callback>)?)
	local results: { [string]: T.Callback } =
		self:filterMembers({ Filter.MemberType("Callback"), ... })

	return results
end

--[=[
	@method GetCallback
	@within Class
	@param name string
	@return Callback?

	Returns the callback with the given name, or nil if it
	does not exist.
]=]
function Class:GetCallback(name: string): T.Callback?
	return self:GetCallbacks(name)[name]
end

return Class
