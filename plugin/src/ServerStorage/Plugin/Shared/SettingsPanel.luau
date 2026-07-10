local Config = require(script.Parent.Config)

local SettingsPanel = {}

local widget: DockWidgetPluginGui? = nil
local connections: { RBXScriptConnection } = {}
local savePendingSettings: (() -> boolean)? = nil

local ERROR_COLOR = Color3.fromRGB(235, 95, 95)

local function track(connection: RBXScriptConnection)
	table.insert(connections, connection)
end

local function addCorner(parent: Instance, radius: number)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius)
	corner.Parent = parent
end

local function addStroke(parent: Instance): UIStroke
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 1
	stroke.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	stroke.Parent = parent
	return stroke
end

local function makeLabel(parent: Instance, text: string, height: number): TextLabel
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.SourceSans
	label.Text = text
	label.TextSize = 14
	label.TextWrapped = true
	label.TextXAlignment = Enum.TextXAlignment.Left
	label.Size = UDim2.new(1, 0, 0, height)
	label.Parent = parent
	return label
end

local function makeField(parent: Instance, labelText: string): (Frame, TextLabel, TextBox, UIStroke)
	local field = Instance.new("Frame")
	field.BackgroundTransparency = 1
	field.Size = UDim2.new(1, 0, 0, 54)
	field.Parent = parent

	local label = makeLabel(field, labelText, 18)
	label.TextSize = 13

	local input = Instance.new("TextBox")
	input.AnchorPoint = Vector2.new(0, 1)
	input.Position = UDim2.fromScale(0, 1)
	input.Size = UDim2.new(1, 0, 0, 32)
	input.ClearTextOnFocus = false
	input.Font = Enum.Font.SourceSans
	input.TextSize = 14
	input.TextXAlignment = Enum.TextXAlignment.Left
	input.Parent = field
	addCorner(input, 4)

	local padding = Instance.new("UIPadding")
	padding.PaddingLeft = UDim.new(0, 9)
	padding.PaddingRight = UDim.new(0, 9)
	padding.Parent = input

	return field, label, input, addStroke(input)
end

function SettingsPanel.Init(pluginObject: Plugin, settingsButton: PluginToolbarButton, onSaved: () -> ())
	if widget then
		return
	end

	local widgetInfo = DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Float, false, false, 340, 220, 300, 200)
	widget = pluginObject:CreateDockWidgetPluginGuiAsync("VerdeSettings", widgetInfo)
	widget.Title = "Verde Settings"
	widget.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	local root = Instance.new("Frame")
	root.Name = "Root"
	root.BorderSizePixel = 0
	root.Size = UDim2.fromScale(1, 1)
	root.Parent = widget

	local padding = Instance.new("UIPadding")
	padding.PaddingTop = UDim.new(0, 14)
	padding.PaddingBottom = UDim.new(0, 14)
	padding.PaddingLeft = UDim.new(0, 16)
	padding.PaddingRight = UDim.new(0, 16)
	padding.Parent = root

	local list = Instance.new("UIListLayout")
	list.Padding = UDim.new(0, 7)
	list.SortOrder = Enum.SortOrder.LayoutOrder
	list.Parent = root

	local hostField, hostLabel, hostBox, hostStroke = makeField(root, "Host / IP")
	hostField.LayoutOrder = 2
	hostBox.PlaceholderText = "localhost"

	local portField, portLabel, portBox, portStroke = makeField(root, "Port")
	portField.LayoutOrder = 3
	portBox.PlaceholderText = "9000"

	local autoConnect = Config.AUTO_CONNECT
	local autoRow = Instance.new("Frame")
	autoRow.BackgroundTransparency = 1
	autoRow.Size = UDim2.new(1, 0, 0, 32)
	autoRow.LayoutOrder = 4
	autoRow.Parent = root

	local autoLabel = makeLabel(autoRow, "Auto Connect on Start", 32)
	autoLabel.Size = UDim2.new(1, -32, 1, 0)

	local autoCheckbox = Instance.new("TextButton")
	autoCheckbox.AnchorPoint = Vector2.new(1, 0.5)
	autoCheckbox.Position = UDim2.new(1, 0, 0.5, 0)
	autoCheckbox.Size = UDim2.fromOffset(20, 20)
	autoCheckbox.AutoButtonColor = true
	autoCheckbox.Font = Enum.Font.SourceSansBold
	autoCheckbox.TextSize = 14
	autoCheckbox.Parent = autoRow
	addCorner(autoCheckbox, 3)
	local autoStroke = addStroke(autoCheckbox)

	local status = makeLabel(root, "", 18)
	status.TextSize = 12
	status.LayoutOrder = 5

	local statusIsError = false
	local studioSettings = settings().Studio

	local function updateAutoCheckbox()
		autoCheckbox.Text = if autoConnect then "✓" else ""
	end

	local function applyTheme()
		local theme = studioSettings.Theme
		root.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainBackground)
		hostLabel.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
		portLabel.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)

		for _, input in { hostBox, portBox } do
			input.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.InputFieldBackground)
			input.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainText)
			input.PlaceholderColor3 = theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
		end

		local inputBorder = theme:GetColor(Enum.StudioStyleGuideColor.InputFieldBorder)
		hostStroke.Color = inputBorder
		portStroke.Color = inputBorder
		autoLabel.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainText)
		autoCheckbox.BackgroundColor3 = theme:GetColor(Enum.StudioStyleGuideColor.InputFieldBackground)
		autoCheckbox.TextColor3 = theme:GetColor(Enum.StudioStyleGuideColor.MainText)
		autoStroke.Color = theme:GetColor(Enum.StudioStyleGuideColor.InputFieldBorder)
		status.TextColor3 = if statusIsError then ERROR_COLOR else theme:GetColor(Enum.StudioStyleGuideColor.DimmedText)
	end

	local function refresh()
		hostBox.Text = Config.HOST
		portBox.Text = tostring(Config.PORT)
		autoConnect = Config.AUTO_CONNECT
		updateAutoCheckbox()
	end

	local function setStatus(message: string, isError: boolean)
		status.Text = message
		statusIsError = isError
		applyTheme()
	end

	local function saveCurrentSettings(): boolean
		local port = tonumber(portBox.Text)
		if not port then
			setStatus("Port must be a whole number from 1 to 65535.", true)
			return false
		end

		local saved, saveError = Config.Save(pluginObject, hostBox.Text, port, autoConnect)
		if not saved then
			setStatus(saveError or "Could not save settings.", true)
			return false
		end

		refresh()
		setStatus("", false)
		onSaved()
		return true
	end

	savePendingSettings = saveCurrentSettings

	track(autoCheckbox.Activated:Connect(function()
		autoConnect = not autoConnect
		updateAutoCheckbox()
		setStatus("", false)
	end))

	track(settingsButton.Click:Connect(function()
		if not widget then
			return
		end

		if widget.Enabled then
			if saveCurrentSettings() then
				widget.Enabled = false
			end
			return
		end

		refresh()
		setStatus("", false)
		widget.Enabled = true
	end))

	track(widget:GetPropertyChangedSignal("Enabled"):Connect(function()
		settingsButton:SetActive(widget ~= nil and widget.Enabled)
	end))

	widget:BindToClose(function()
		if widget and saveCurrentSettings() then
			widget.Enabled = false
		end
	end)

	track(studioSettings.ThemeChanged:Connect(applyTheme))

	refresh()
	applyTheme()
	settingsButton:SetActive(widget.Enabled)
end

function SettingsPanel.Cleanup()
	if savePendingSettings then
		savePendingSettings()
		savePendingSettings = nil
	end
	for _, connection in connections do
		connection:Disconnect()
	end
	table.clear(connections)

	if widget then
		widget:Destroy()
		widget = nil
	end
end

return SettingsPanel
