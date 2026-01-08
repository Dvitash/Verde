local PropertyTracker = require(script.Parent.Parent.Shared.PropertyTracker)

return function(operation)
	PropertyTracker.cleanupTracking()
	return true
end

