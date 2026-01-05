# Verde

![Verde Logo](extension/logo.png)

A VS Code extension that provides a tree view explorer window

## Features

- **Live Instance Tree**: View your Roblox game's instance hierarchy in VS Code
- **Script Opening**: Double-click scripts to open them in VS Code (works with Rojo/Argon/Azul sourcemaps)
- **Instance Operations**: Rename, duplicate, delete, copy, and paste instances
- **Properties Panel**: View and edit instance properties right from VS Code

![Sample Image](extension/assets/sample.png)

## Requirements

- Roblox Studio with the Verde plugin installed
- A Rojo/Argon/Azul setup with sourcemap generation (for script opening functionality)

## Extension Installation

### From VSIX
1. Run `npm run package` in the extension directory to create a `.vsix` file
2. In VS Code, press Ctrl + Shift + P to open the command palette
3. Select "Install from VSIX..." and choose the generated `.vsix` file

### Online
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Dvitash.verde)

## Setup

1. Install the [Verde plugin](https://create.roblox.com/store/asset/84296161836385) in Roblox Studio
2. Open your VS Code workspace
3. The extension will automatically start a WebSocket server
4. Open Roblox Studio and run your game with the plugin
5. The Roblox Explorer view should appear in VS Code

## Extension Settings

* `verde.sourcemapPath`: Path to sourcemap file (relative to workspace root) - defaults to "sourcemap.json"
* `verde.port`: Port for the WebSocket server - defaults to 9000  
* `verde.host`: Host IP address for the WebSocket server - defaults to "localhost"
* `verde.autoStart`: Automatically start the server when the extension activates - defaults to true

## Usage

### Opening Scripts
1. Click on any Script, LocalScript, or ModuleScript in the explorer
2. The extension will look up the file path in your sourcemap (if it exists)
3. The corresponding file will open in VS Code

### Instance Operations
- Right-click instances for context menu options
- Use keyboard shortcuts for quick operations:
  - `Enter`: Rename
  - `Delete`: Delete
  - `Ctrl+C`: Copy
  - `Ctrl+V`: Paste
  - `Ctrl+D`: Duplicate
  - `Ctrl+Shift+A`: Open new instance panel