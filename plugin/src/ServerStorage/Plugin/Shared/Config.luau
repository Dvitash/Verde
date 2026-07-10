local DEFAULT_HOST = "localhost"
local DEFAULT_PORT = 9000
local DEFAULT_AUTO_CONNECT = true
local SETTINGS_KEY = "VerdePluginSettings"

local Config = {
	HOST = DEFAULT_HOST,
	PORT = DEFAULT_PORT,
	AUTO_CONNECT = DEFAULT_AUTO_CONNECT,
	RETRY_INTERVAL_SECONDS = 1.0,
	DEBUG = false,
}

local function trim(value: string): string
	return value:match("^%s*(.-)%s*$") or ""
end

local function validateHost(host: any): (boolean, string?)
	if type(host) ~= "string" then
		return false, "Host must be text."
	end

	host = trim(host)
	if host == "" then
		return false, "Host is required."
	end

	if host:find("%s") or host:find("/", 1, true) or host:find("://", 1, true) then
		return false, "Enter a host or IP without a protocol, path, or spaces."
	end

	return true
end

local function validatePort(port: any): (boolean, string?)
	if type(port) ~= "number" or port ~= math.floor(port) or port < 1 or port > 65535 then
		return false, "Port must be a whole number from 1 to 65535."
	end

	return true
end

function Config.Load(pluginObject: Plugin)
	local stored = pluginObject:GetSetting(SETTINGS_KEY)
	if type(stored) ~= "table" then
		return
	end

	local hostIsValid = validateHost(stored.host)
	if hostIsValid then
		Config.HOST = trim(stored.host)
	end

	local portIsValid = validatePort(stored.port)
	if portIsValid then
		Config.PORT = stored.port
	end

	if type(stored.autoConnect) == "boolean" then
		Config.AUTO_CONNECT = stored.autoConnect
	end
end

function Config.Save(pluginObject: Plugin, host: string, port: number, autoConnect: boolean): (boolean, string?)
	local hostIsValid, hostError = validateHost(host)
	if not hostIsValid then
		return false, hostError
	end

	local portIsValid, portError = validatePort(port)
	if not portIsValid then
		return false, portError
	end

	if type(autoConnect) ~= "boolean" then
		return false, "Auto-connect must be on or off."
	end

	local nextHost = trim(host)
	local success, saveError = pcall(function()
		pluginObject:SetSetting(SETTINGS_KEY, {
			host = nextHost,
			port = port,
			autoConnect = autoConnect,
		})
	end)

	if not success then
		return false, "Could not save settings: " .. tostring(saveError)
	end

	Config.HOST = nextHost
	Config.PORT = port
	Config.AUTO_CONNECT = autoConnect

	return true
end

function Config.GetWebSocketUrl(): string
	local host = Config.HOST
	if host:find(":", 1, true) and host:sub(1, 1) ~= "[" then
		host = "[" .. host .. "]"
	end

	return `ws://{host}:{Config.PORT}`
end

return Config
