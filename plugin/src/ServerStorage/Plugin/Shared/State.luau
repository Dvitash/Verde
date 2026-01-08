export type TransitionCallback = (stateName: string) -> ()

export type State = {
	onEnter: (transitionTo: TransitionCallback, ...any) -> (),
	onExit: () -> (),
	onUpdate: (transitionTo: TransitionCallback, dt: number) -> (),
}
local State = {}

function State.new(): State
	local self = {} :: State

	self.onEnter = function(transitionTo: TransitionCallback, ...)
		error("OnEnter not implemented")
	end

	self.onExit = function()
		error("OnExit not implemented")
	end

	self.onUpdate = function(transitionTo: TransitionCallback, dt: number)
		error("OnUpdate not implemented")
	end

	return self
end

return State
