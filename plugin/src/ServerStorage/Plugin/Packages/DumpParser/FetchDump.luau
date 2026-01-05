--!strict
--[=[
	@class FetchDump
	@private

	An internal module that handles fetching the Roblox API dump
	from the Roblox API. It is accessed by the [`fetchDump`][Dump.fetchDump]
	function on the [`Dump`][Dump] class.
]=]
local HttpService = game:GetService("HttpService")

local T = require(script.Parent["init.d"])

local URL_DEPLOY_HISTORY = "https://s3.amazonaws.com/setup.roblox.com/DeployHistory.txt"
local URL_VERSION_DUMP = "https://s3.amazonaws.com/setup.roblox.com/version-%s-API-Dump.json"
local URL_CURRENT_VERSION = "https://s3.amazonaws.com/setup.roblox.com/versionQTStudio"

-- selene: allow(undefined_variable)
local RobloxVersion = version()

local function HttpRequest<T>(url: string, json: boolean?): T
	local response = HttpService:RequestAsync({
		Url = url,
	})

	if json then
		return HttpService:JSONDecode(response.Body)
	end

	return response.Body
end

--[=[
	@function fetchLatestVersionHash
	@within FetchDump
	@return string

	Fetches the latest Roblox version hash from the Roblox API.
]=]
local function FetchLatestVersionHash(): string
	local versionHash: string = HttpRequest(URL_CURRENT_VERSION)
	local hash = versionHash:match("version%-(%x+)")

	return hash
end

--[=[
	@function fetchVersionHash
	@within FetchDump
	@param version string?
	@return string

	Fetches the Roblox version hash for the given version from the
	Roblox API. If no version is provided, it will default to the
	current version.
]=]
local function FetchVersionHash(version: string?): string
	version = version or RobloxVersion

	local deployHistory: string = HttpRequest(URL_DEPLOY_HISTORY)
	local deployments = deployHistory:split("\n")
	local versionHash: string = nil

	for lineNumber = #deployments, 1, -1 do
		local line = deployments[lineNumber]

		if line:find(version) then
			versionHash = line:match("version%-(%x+)")
			break
		end

		if lineNumber >= 128 then
			error("Could not find version hash for version " .. version)
		end
	end

	return versionHash
end

--[=[
	@function fetchVersionHashWithFallback
	@within FetchDump
	@param version string?
	@return string

	Fetches the Roblox version hash for the given version from the
	Roblox API. If no version is provided, it will default to the
	current version. If the version hash cannot be found within the
	deployment history, it will fallback to the latest version hash
	on the server.
]=]
local function FetchVersionHashWithFallback(version: string?): string
	local ok, versionHash = pcall(FetchVersionHash, version)

	if not ok then
		versionHash = FetchLatestVersionHash()
	end

	return versionHash
end

--[=[
	@function fetchDump
	@within FetchDump
	@param hashOrVersion string?
	@return (APIDump, versionHash)

	Fetches the API dump for the current version of Roblox from the
	Roblox API. If a hash or version is provided, it will attempt to
	fetch the dump for that hash or version.
]=]
local function FetchDump(hashOrVersion: string?): T.APIDump
	local isVersionString = hashOrVersion and hashOrVersion:match("%d+%.") ~= nil

	if hashOrVersion == nil then
		hashOrVersion = RobloxVersion
		isVersionString = true
	end

	if isVersionString then
		hashOrVersion = FetchVersionHashWithFallback(hashOrVersion)
	end

	local versionHash = hashOrVersion :: string
	local apiDump = HttpRequest(URL_VERSION_DUMP:format(versionHash), true)

	return apiDump, versionHash
end

return {
	fetchDump = FetchDump,
	fetchLatestVersionHash = FetchLatestVersionHash,
	fetchVersionHash = FetchVersionHash,
	fetchVersionHashWithFallback = FetchVersionHashWithFallback,
}
