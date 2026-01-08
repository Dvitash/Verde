local HttpService = game:GetService("HttpService")

local SharedFolder = script.Parent.Parent.Shared

local SerializeDatamodel = require(script.Parent.Parent.SerializeDatamodel)
local isValidInstance = require(script.Parent.Parent.Utils.isValidInstance)
local WebSocketClient = require(script.Parent.Parent.WebSocketClient)
local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)
local Services = require(script.Parent.Parent.Shared.Services)
local Promise = require(script.Parent.Parent.Packages.Promise)
local PropertyTracker = require(SharedFolder.PropertyTracker)
local ButtonInstance = require(SharedFolder.ButtonInstance)
local Icons = require(SharedFolder.Icons)
local State = require(SharedFolder.State)

type Client = WebSocketClient.WebSocketClientInstance

local PROPERTIES_TO_WATCH = {
	"Name",
}

local operations: { [string]: (...any) -> boolean } = {}
local connections: { RBXScriptConnection } = {}
local snapshotPromise: any = nil

local lastAckTime = 0

for _, operationMod in script.Parent.Parent.Operations:GetChildren() do
	local operation = require(operationMod)
	operations[operationMod.Name] = operation
end

local function _sendSnapshot(client: Client)
	if not client or not client.connected then
		print("sendSnapshot: not connected")
		return
	end

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
		error("sendSnapshot: failed to encode JSON:", jsonString)
		return
	end

	assert(client:send(jsonString), "failed to send snapshot")
end

local function _queueSnapshot(client: Client)
	if snapshotPromise then
		snapshotPromise:cancel()
	end

	snapshotPromise = Promise.delay(0.1):andThen(function()
		snapshotPromise = nil
		_sendSnapshot(client)
	end)
end

local function _sendOperationResult(
	client: Client,
	operationId: string,
	success: boolean,
	errorMessage: string?,
	data: any?
)
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

local propertyUpdatePromise: any = nil
local getProperties = require(script.Parent.Parent.Operations.get_properties)

local function _sendPropertyUpdate(client: Client, nodeId: string)
	if not client or not client.connected then
		return
	end

	if propertyUpdatePromise then
		propertyUpdatePromise:cancel()
	end

	propertyUpdatePromise = Promise.delay(0.1):andThen(function()
		propertyUpdatePromise = nil

		local propertiesResult = getProperties({ nodeId = nodeId })
		if not propertiesResult then
			return
		end

		local message = {
			type = "property_update",
			nodeId = nodeId,
			properties = propertiesResult,
		}

		local jsonSuccess, jsonString = pcall(function()
			return HttpService:JSONEncode(message)
		end)

		if not jsonSuccess then
			warn("[verde] failed to encode property update:", jsonString)
			return
		end

		client:send(jsonString)
	end)
end

local function _handleOperation(client: Client, operationId: string, operation: any)
	if not operation or not operation.type then
		_sendOperationResult(client, operationId, false, "invalid_operation")
		return
	end

	local operationFunction = operations[operation.type]

	if operationFunction then
		local result, errorMsg = operationFunction(operation)

		local success = result ~= nil and result ~= false
		local data = success and result
		local errorMessage = if success then nil else (errorMsg or "operation_failed")

		_sendOperationResult(client, operationId, success, errorMessage, data)

		if success then
			_queueSnapshot(client)
		end
	else
		_sendOperationResult(client, operationId, false, "unknown_operation_type: " .. operation.type)
	end
end

local function _sendAck(client: Client, requestId: string?, force: boolean?)
	lastAckTime = tick()

	local message = {
		type = "ack",
	}

	if requestId then
		message.requestId = requestId
	end

	if not client or not client.connected then
		return
	end

	local jsonSuccess, jsonString = pcall(function()
		return HttpService:JSONEncode(message)
	end)

	if not jsonSuccess then
		warn("[verde] failed to encode ack:", jsonString)
		return
	end

	client:send(jsonString)
end

local _messageHandlers = {
	["operation"] = function(client: Client, data: any)
		_handleOperation(client, data.operationId, data.operation)
	end,
	["request_snapshot"] = function(client: Client, data: any)
		_sendSnapshot(client)
	end,
	["ack"] = function(client: Client, data: any)
		_sendAck(client, data.requestId)
	end,
}

local function _listenToChanges(client: Client, descendant: Instance)
	for _, property in PROPERTIES_TO_WATCH do
		table.insert(
			connections,
			descendant:GetPropertyChangedSignal(property):Connect(function()
				_queueSnapshot(client)
			end)
		)

		table.insert(
			connections,
			descendant.AttributeChanged:Connect(function()
				_queueSnapshot(client)
			end)
		)
	end
end

local connected = State.new()

connected.onEnter = function(transitionTo: (string) -> (), client: WebSocketClient.WebSocketClientInstance?)
	if not client then
		warn("[verde] no client provided")
		transitionTo("Disconnected")
		return
	end

	connected.client = client

	PropertyTracker.setUpdateCallback(function(nodeId: string)
		_sendPropertyUpdate(client, nodeId)
	end)

	client:on("message", function(data)
		if not data or not data.type then
			return
		end

		local handler = _messageHandlers[data.type]

		if handler then
			handler(client, data)
		end
	end)

	for _, serviceName in Services do
		local service = game:GetService(serviceName)

		_listenToChanges(client, service)

		for _, descendant in service:GetDescendants() do
			_listenToChanges(client, descendant)
		end
	end

	table.insert(
		connections,
		game.DescendantAdded:Connect(function(descendant)
			if not isValidInstance(descendant) then
				return
			end

			_listenToChanges(client, descendant)
			_queueSnapshot(client)
		end)
	)

	table.insert(
		connections,
		game.DescendantRemoving:Connect(function(descendant)
			local instanceId = descendant:GetDebugId(0)
			if not InstanceMap[instanceId] then
				return
			end

			InstanceMap[instanceId] = nil

			_queueSnapshot(client)
		end)
	)

	if ButtonInstance.button then
		ButtonInstance.button.Icon = Icons.CONNECTED
	end

	lastAckTime = tick()
	_sendSnapshot(client)
end

connected.onExit = function()
	if connected.client then
		connected.client:disconnect()
		connected.client = nil
	end

	PropertyTracker.cleanupTracking()

	for _, connection in connections do
		connection:Disconnect()
	end

	if snapshotPromise then
		snapshotPromise:cancel()
	end

	if propertyUpdatePromise then
		propertyUpdatePromise:cancel()
	end

	table.clear(connections)
	table.clear(InstanceMap)
	lastAckTime = tick()
end

connected.onUpdate = function(dt, transitionTo: (string) -> ())
	local now = tick()

	if now - lastAckTime > 5 then
		transitionTo("Disconnected")
		return
	end
end

return connected
