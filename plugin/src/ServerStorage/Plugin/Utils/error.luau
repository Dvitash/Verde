return function(...: any)
	local args = { ... }

	for i, arg in ipairs(args) do
		args[i] = tostring(arg)
	end

	error("[Verde] " .. table.concat(args, " "))
end
