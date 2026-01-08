local RunService = game:GetService("RunService")

local StateModule = require(script.Parent.Parent.Shared.State)

type State = StateModule.State

local _currentState: State? = nil
local _states = {}

local StateController = {}

for _, stateModule in script.Parent:GetChildren() do
	if stateModule == script or not stateModule:IsA("ModuleScript") then
		continue
	end

	local state = require(stateModule)
	_states[stateModule.Name] = state
end

local function _transitionTo(stateName: string)
	StateController.SwitchState(stateName)
end

function StateController.SwitchState(stateName: string)
	assert(_states[stateName], "State not found")

	local retValue = nil

	if _currentState then
		retValue = _currentState:onExit()
	end

	_currentState = _states[stateName]
	_currentState.onEnter(_transitionTo, retValue)
end

function StateController.GetState(): string?
	local stateName = nil

	for name, state in _states do
		if state == _currentState then
			stateName = name
			break
		end
	end

	return stateName
end

RunService.Heartbeat:Connect(function(dt)
	if RunService:IsRunning() then
		return
	end

	if not _currentState then
		return
	end

	_currentState.onUpdate(dt, _transitionTo)
end)

return StateController
