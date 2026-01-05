--!strict
--[=[
	@class Types
]=]

--[=[
	@type GenericFilter <T>(object: T) -> any?
	@within Types

	A generic filter function that takes an object of type T and
	returns a boolean value indicating whether or not the object
	should be included in the result.
]=]
export type GenericFilter<T> = (object: T) -> any?

--[=[
	@interface Property
	@within Types
	.MemberType "Property"
	.Category string
	.Name string
	.Security { Read: string, Write: string }
	.Serialization { CanLoad: boolean, CanSave: boolean }
	.Tags { string }?
	.ThreadSafety string
	.ValueType { Category: string, Name: string }
]=]
export type Property = {
	MemberType: "Property",
	Category: string,
	Name: string,
	Security: {
		Read: string,
		Write: string,
	},
	Serialization: {
		CanLoad: boolean,
		CanSave: boolean,
	},
	Tags: { string }?,
	ThreadSafety: string,
	ValueType: {
		Category: string,
		Name: string,
	},
}

--[=[
	@interface Function
	@within Types
	.MemberType "Function"
	.Name string
	.Parameters {{ Name: string, Type: string, Default: string? }}
	.ReturnType { Category: string, Name: string }
	.Security string
	.Tags { string }?
	.ThreadSafety string
]=]
export type Function = {
	MemberType: "Function",
	Name: string,
	Parameters: { { Name: string, Type: string, Default: string? } },
	ReturnType: { Category: string, Name: string },
	Security: string,
	Tags: { string }?,
	ThreadSafety: string,
}

--[=[
	@interface Event
	@within Types
	.MemberType "Event"
	.Name string
	.Parameters {{ Name: string, Type: string }}
	.Security string
	.Tags { string }?
	.ThreadSafety string
]=]
export type Event = {
	MemberType: "Event",
	Name: string,
	Parameters: { { Name: string, Type: string } },
	Security: string,
	Tags: { string }?,
	ThreadSafety: string,
}

--[=[
	@interface Callback
	@within Types
	.MemberType "Callback"
	.Name string
	.Parameters {{ Name: string, Type: string }}
	.ReturnType { Category: string, Name: string }
	.Security string
	.Tags { string }?
	.ThreadSafety string
]=]
export type Callback = {
	MemberType: "Callback",
	Name: string,
	Parameters: { { Name: string, Type: string } },
	ReturnType: { Category: string, Name: string },
	Security: string,
	Tags: { string }?,
	ThreadSafety: string,
}

--[=[
	@type APIDump { Classes: { [any]: any }, [string]: any }
	@within Types

	An API dump is a table that contains the raw Roblox API dump
	data. As a minimum, the Dump expects an APIDump to contain
	a `Classes` array.
]=]
export type APIDump = {
	Classes: { [any]: any },
	[string]: any,
}

--[=[
	@type Member Property | Function | Event | Callback
	@within Types
]=]
export type Member = Property | Function | Event | Callback

--[=[
	@interface Class
	@within Types
	.Members { Member }
	.MemoryCategory string
	.Name string
	.Superclass string
	.Tags { string }?
]=]
export type Class = {
	Members: { Member },
	MemoryCategory: string,
	Name: string,
	Superclass: string,
	Tags: { string }?,
}

--[=[
	@type ClassWithInheritance Class & { Inherits: { string } }
	@within Types
]=]
export type ClassWithInheritance = Class & {
	Inherits: { string },
}

--[=[
	@type Item Member | Class
	@within Types
]=]
export type Item = Member | Class

return {}
