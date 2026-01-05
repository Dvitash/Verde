# Verde

A VS Code extension that provides a tree view explorer for Roblox Studio instances

## Features

- **Live Instance Tree**: View your Roblox game's instance hierarchy in VS Code
- **Script Opening**: Double-click scripts to open them in VS Code (works with Rojo/Argon/Azul sourcemaps)
- **Instance Operations**: Rename, duplicate, delete, copy, and paste instances
- **Properties Panel**: View and edit instance properties right from VS Code

## Requirements

- Roblox Studio with the RblxExplorer plugin installed
- A Rojo or Azul setup with sourcemap generation (for script opening functionality)

## Installation

### From VSIX (Local Testing)
1. Run `npm run package` in the extension directory to create a `.vsix` file
2. In VS Code, open the Extensions view and click the "..." menu
3. Select "Install from VSIX..." and choose the generated `.vsix` file

### From Marketplace (Coming Soon)
Once published, install from the VS Code marketplace.

## Setup

1. Install the RblxExplorer plugin in Roblox Studio
2. Open your VS Code workspace
3. The extension will automatically start a WebSocket server
4. Open Roblox Studio and run your game with the plugin
5. The Roblox Explorer view should appear in VS Code

## Extension Settings

* `rblxexplorer.sourcemapPaths`: Array of paths to sourcemap files (relative to workspace root)
* `rblxexplorer.port`: WebSocket server port (default: 9000)
* `rblxexplorer.host`: WebSocket server host (default: localhost)
* `rblxexplorer.autoStart`: Whether to start the server automatically (default: true)

## Usage

### Opening Scripts
1. Double-click on any Script, LocalScript, or ModuleScript in the explorer
2. The extension will look up the file path in your sourcemap
3. The corresponding file will open in VS Code

### Instance Operations
- Right-click instances for context menu options
- Use keyboard shortcuts for quick operations:
  - `F2`: Rename
  - `Delete`: Delete
  - `Ctrl+C`: Copy
  - `Ctrl+V`: Paste
  - `Ctrl+D`: Duplicate
  - `Ctrl+Shift+A`: Add child

## Known Issues

- Script opening requires properly configured sourcemaps from Rojo/Azul
- Only works with running Roblox games that have the companion plugin

## Release Notes

### 0.0.1
- Initial release
- Basic instance tree viewing
- Instance operations (rename, duplicate, delete, copy/paste)
- Properties panel
- Script opening with sourcemap support
