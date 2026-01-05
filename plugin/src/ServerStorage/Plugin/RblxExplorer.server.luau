--[[
	RblxExplorer - Roblox Studio Plugin
	Compnaion plugin for the RblxExplorer VSCode extension.

	Dvitash 1/4/2026
--]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local SerializeDatamodel = require(script.Parent.SerializeDatamodel)
local WebSocketClient = require(script.Parent.WebSocketClient)
local InstanceMap = require(script.Parent.Shared.InstanceMap)
local Promise = require(script.Parent.Packages.Promise)
local Services = require(script.Parent.Shared.Services)
local print = require(script.Parent.Utils.print)

if RunService:IsRunning() then
	return
end

local PLUGIN_NAME = "RblxExplorer"
local ICON_DISCONNECTED = "rbxassetid://123083759878787"
local ICON_CONNECTING = "rbxassetid://112607063142486"
local ICON_CONNECTED = "rbxassetid://140416565070932"

-- todo: in-studio settings
local CONFIG = {
	WS_URL = "ws://localhost:9000",
	RETRY_INTERVAL_SECONDS = 1.0,
	DEBUG = true,
}

local STATES = {
	DISCONNECTED = "disconnected",
	CONNECTING = "connecting",
	CONNECTED = "connected",
}

local PROPERTIES_TO_WATCH = {
	"Name",
	"Parent",
}

local pluginToolbar = plugin:CreateToolbar(PLUGIN_NAME)
local connectButton = pluginToolbar:CreateButton("Toggle", "toggle connection to vscode", ICON_DISCONNECTED)
connectButton:SetActive(false)

local client: WebSocketClient.WebSocketClientInstance? = nil

local currentConnectionState = STATES.DISCONNECTED
local handshakePollingThread: thread? = nil
local ackLoopThread: thread? = nil

local function stopHandshakePolling()
	if handshakePollingThread then
		task.cancel(handshakePollingThread)
		handshakePollingThread = nil
	end
end

local function stopAckLoop()
	if ackLoopThread then
		task.cancel(ackLoopThread)
		ackLoopThread = nil
	end
end

local function startAckLoop()
	if ackLoopThread then
		return
	end

	ackLoopThread = task.spawn(function()
		while currentConnectionState == STATES.CONNECTED do
			if client then
				local success = pcall(function()
					local message = {
						type = "ack",
						timestamp = os.time(),
					}
					local jsonString = HttpService:JSONEncode(message)
					client:send(jsonString)
				end)

				if not success then
					print("Failed to send ACK")
				end
			end

			task.wait(0.25) -- Send ACK every 0.25 seconds
		end
	end)
end

local connections: { RBXScriptConnection } = {}
local snapshotPromise: any = nil
local connectionEnabled = false

local operations: { [string]: (...any) -> boolean } = {}

for _, operationMod in script.Parent.Operations:GetChildren() do
	local operation = require(operationMod)
	operations[operationMod.Name] = operation
end

local function setButtonState()
	connectButton:SetActive(connectionEnabled)

	if currentConnectionState == STATES.CONNECTING then
		connectButton.Icon = ICON_CONNECTING
	elseif currentConnectionState == STATES.CONNECTED then
		connectButton.Icon = ICON_CONNECTED
	else
		connectButton.Icon = ICON_DISCONNECTED
	end
end

local function sendSnapshot()
	if not client or not client.connected then
		print("sendSnapshot: not connected")
		return
	end

	local startTime = os.clock()
	local snapshot, _instanceMap = SerializeDatamodel()

	for id, instance in _instanceMap do
		InstanceMap[id] = instance
	end

	local message = {
		type = "explorer_snapshot",
		payload = snapshot,
	}

	local jsonSuccess, jsonString = pcall(function()
		return HttpService:JSONEncode(message)
	end)

	if not jsonSuccess then
		print("sendSnapshot: failed to encode JSON:", jsonString)
		return
	end

	local jsonSizeKB = math.floor(#jsonString / 1024)

	local sendSuccess = client:send(jsonString)
	local totalTime = os.clock() - startTime

	if sendSuccess then
		print(string.format("sendSnapshot: sent %d nodes (%d KB) in %.3fs", #snapshot.nodes, jsonSizeKB, totalTime))
	else
		print("sendSnapshot: failed to send")
	end
end

local function queueSnapshot()
	if snapshotPromise then
		snapshotPromise:cancel()
	end

	snapshotPromise = Promise.delay(0.1):andThen(function()
		snapshotPromise = nil
		sendSnapshot()
	end)
end

local function disconnect()
	stopHandshakePolling()
	stopAckLoop()

	if snapshotPromise then
		snapshotPromise:cancel()
		snapshotPromise = nil
	end

	if client then
		client:disconnect()
		client = nil
	end

	for _, connection in connections do
		connection:Disconnect()
	end

	table.clear(connections)
	table.clear(InstanceMap)

	setButtonState()
end

local function sendOperationResult(operationId: string, success: boolean, errorMessage: string?, data: any?)
	local message = {
		type = "operation_result",
		operationId = operationId,
		result = {
			success = success,
			error = if success then nil else errorMessage,
			data = data,
		},
	}

	if not client or not client.connected then
		print("sendOperationResult: not connected")
		return
	end

	local jsonSuccess, jsonString = pcall(function()
		return HttpService:JSONEncode(message)
	end)

	if not jsonSuccess then
		print("sendOperationResult: failed to encode JSON:", jsonString)
		return
	end

	local sendSuccess = client:send(jsonString)

	if not sendSuccess then
		print("sendOperationResult: failed to send")
	end
end

local function handleOperation(operationId: string, operation: any)
	if not operation or not operation.type then
		sendOperationResult(operationId, false, "invalid_operation")
		return
	end

	local operationFunction = operations[operation.type]

	if operationFunction then
		local result = operationFunction(operation)

		local success = result ~= nil and result ~= false
		local data = success and result
		local errorMessage = if success then nil else "operation_failed"

		sendOperationResult(operationId, success, errorMessage, data)

		if success then
			queueSnapshot()
		end
	else
		sendOperationResult(operationId, false, "unknown_operation_type: " .. operation.type)
	end
end

local function ensureClient(): boolean
	if client and client.connected then
		return true
	end

	if client then
		client:disconnect()
		client = nil
	end

	local newClient = WebSocketClient.new(CONFIG.WS_URL, {
		debugMode = CONFIG.DEBUG,
		silentMode = true,
	})

	newClient:on("connect", function()
		print("WebSocket connected")
		currentConnectionState = STATES.CONNECTING
		setButtonState()
	end)

	newClient:on("disconnect", function()
		currentConnectionState = STATES.DISCONNECTED
		setButtonState()
	end)

	newClient:on("message", function(data)
		if not data or not data.type then
			return
		end

		if data.type == "operation" then
			handleOperation(data.operationId, data.operation)
		elseif data.type == "request_snapshot" then
			sendSnapshot()
		elseif data.type == "ack" and currentConnectionState == STATES.CONNECTING then
			currentConnectionState = STATES.CONNECTED
			stopHandshakePolling()
			setButtonState()

			startAckLoop()

			task.defer(sendSnapshot)
			print("sync complete")
		end
	end)

	newClient:on("error", function(errorMessage: string)
		print("error:", errorMessage)
	end)

	local ok = newClient:connect()

	if not ok then
		newClient:disconnect()
		return false
	end

	client = newClient
	setButtonState()

	return true
end

local function listenToChanges(descendant: Instance)
	for _, property in PROPERTIES_TO_WATCH do
		table.insert(
			connections,
			descendant:GetPropertyChangedSignal(property):Connect(function()
				queueSnapshot()
			end)
		)
	end
end

local function setEnabled(enabled: boolean)
	connectionEnabled = enabled

	if not connectionEnabled then
		currentConnectionState = STATES.DISCONNECTED
		setButtonState()
		disconnect()

		return
	end

	currentConnectionState = STATES.DISCONNECTED
	setButtonState()

	for _, serviceName in Services do
		local service = game:GetService(serviceName)
		listenToChanges(service)

		for _, descendant in service:GetDescendants() do
			listenToChanges(descendant)
		end
	end

	table.insert(
		connections,
		game.DescendantAdded:Connect(function(descendant)
			listenToChanges(descendant)
			queueSnapshot()
		end)
	)

	table.insert(
		connections,
		game.DescendantRemoving:Connect(function(descendant)
			queueSnapshot()
		end)
	)

	local connectionSuccess = ensureClient()
	if not connectionSuccess then
		currentConnectionState = STATES.DISCONNECTED
		setButtonState()
		return
	end
end

connectButton.Click:Connect(function()
	setEnabled(not connectionEnabled)
end)

plugin.Unloading:Connect(function()
	setEnabled(false)
end)

setButtonState()
