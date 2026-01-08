local SharedFolder = script.Parent.Parent.Shared

local ButtonInstance = require(SharedFolder.ButtonInstance)
local Icons = require(SharedFolder.Icons)
local State = require(SharedFolder.State)

local disconnected = State.new()

disconnected.onEnter = function(transitionTo: (string) -> (), ...)
	if ButtonInstance.button then
		ButtonInstance.button.Icon = Icons.DISCONNECTED
	end
end

disconnected.onExit = function() end
disconnected.onUpdate = function(dt) end

return disconnected
