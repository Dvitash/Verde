local SharedFolder = script.Parent.Parent.Shared

local WebSocketClient = require(script.Parent.Parent.WebSocketClient)
local Config = require(script.Parent.Parent.Shared.Config)
local ButtonInstance = require(SharedFolder.ButtonInstance)
local Icons = require(SharedFolder.Icons)
local State = require(SharedFolder.State)

local connecting = State.new()

connecting.onEnter = function(transitionTo: (string) -> (), ...)
	if ButtonInstance.button then
		ButtonInstance.button.Icon = Icons.CONNECTING
	end

	local client = WebSocketClient.new(Config.WS_URL, {
		debugMode = Config.DEBUG,
		silentMode = true,
	})

	connecting.client = client

	client:on("message", function(data)
		if data and data.type == "ack" then
			connecting.wasConnected = true
			transitionTo("Connected")
		end
	end)

	client:on("disconnect", function()
		transitionTo("Disconnected")
	end)

	client:on("error", function(err)
		warn("[verde] connection error:", err)

		if connecting.client then
			connecting.client:disconnect()
			connecting.client = nil
		end

		transitionTo("Disconnected")
	end)

	local ok = client:connect()
	if not ok then
		if connecting.client then
			connecting.client:disconnect()
			connecting.client = nil
		end

		transitionTo("Disconnected")

		return
	end
end

connecting.onExit = function()
	if not connecting.wasConnected and connecting.client then
		connecting.client:disconnect()
		connecting.client = nil
		return
	end

	return connecting.client
end

connecting.onUpdate = function(dt) end

return connecting
