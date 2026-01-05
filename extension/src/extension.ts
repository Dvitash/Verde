import * as vscode from "vscode";
import { RobloxExplorerProvider, Node } from "./robloxExplorerProvider";
import { VerdeBackend } from "./backend";
import { PropertiesViewProvider } from "./propertiesViewProvider";
import { ROBLOX_CLASS_NAMES } from "./robloxClasses";
import { SourcemapParser } from "./sourcemapParser";

let backend: VerdeBackend | null = null;
let sourcemapParser: SourcemapParser;
let propertiesViewProvider: PropertiesViewProvider;

let scriptActivationTracker: { [nodeId: string]: { count: number, timeout: NodeJS.Timeout | null } } = {};

export async function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel("Verde Backend");
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(statusBarItem);

	const explorerProvider = new RobloxExplorerProvider(context.extensionUri);
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || context.extensionUri;
	sourcemapParser = new SourcemapParser(workspaceRoot);

	const explorerView = vscode.window.createTreeView("verde.view", {
		treeDataProvider: explorerProvider,
		dragAndDropController: explorerProvider.getDragAndDropController(),
		showCollapseAll: true,
		canSelectMany: true
	});

	context.subscriptions.push(explorerView);

	backend = new VerdeBackend(outputChannel, statusBarItem, (snapshot) => {
		explorerProvider.setSnapshot(snapshot);
	}, () => {
		explorerProvider.setSnapshot({ nodes: [], rootIds: [] });
	});

	const watcher = vscode.workspace.createFileSystemWatcher('**/sourcemap.json');
	watcher.onDidChange(() => sourcemapParser.loadSourcemaps());
	watcher.onDidCreate(() => sourcemapParser.loadSourcemaps());
	watcher.onDidDelete(() => sourcemapParser.loadSourcemaps());
	context.subscriptions.push(watcher);

	propertiesViewProvider = new PropertiesViewProvider(backend, context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PropertiesViewProvider.viewType, propertiesViewProvider)
	);

	explorerProvider.setBackend(backend);

	explorerView.onDidChangeSelection((event) => {
		const selection = event.selection;

		if (selection.length === 1) {
			const node = selection[0];
			propertiesViewProvider.show(node);
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand('verde.navigateToInstance', async (instanceId: string) => {
			const node = explorerProvider.getNodeById(instanceId);
			if (node) {
				await explorerView.reveal(node, { select: true, focus: true });
			} else {
				vscode.window.showWarningMessage(`Instance ${instanceId} not found in explorer`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.showOutput", () => {
			outputChannel.show(true);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.stopServer", async () => {
			if (!backend) {
				return;
			}
			await backend.stop();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.startServer", async () => {
			if (!backend) {
				return;
			}
			try {
				await backend.start();
			} catch (error) {
				vscode.window.showErrorMessage(`verde backend failed to start: ${String(error)}`);
				outputChannel.show(true);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.renameInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let node: any = null;
			if (args.length > 0 && args[0]) {
				node = args[0];
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					node = treeSelections[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected to rename");
				return;
			}

			const newName = await vscode.window.showInputBox({
				prompt: `Rename "${node.name}"`,
				value: node.name,
				valueSelection: [0, node.name.length],
				placeHolder: "Enter new name",
				validateInput: (value) => {
					if (!value || value.trim() === "") {
						return "Name cannot be empty";
					}
					return null;
				}
			});

			if (!newName || newName.trim() === "") {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "rename_instance",
					nodeId: node.id,
					newName: newName.trim()
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to rename instance: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to rename instance: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.duplicateInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					nodes = [...treeSelections];
				}
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to duplicate");
				return;
			}

			try {
				let successCount = 0;
				let lastError = null;

				for (const node of nodes) {
					const result = await backend.sendOperation({
						type: "duplicate_instance",
						nodeId: node.id
					});

					if (result.success) {
						successCount++;
					} else {
						lastError = result.error;
					}
				}

				if (successCount < nodes.length) {
					vscode.window.showWarningMessage(
						`Duplicated ${successCount}/${nodes.length} instances. Last error: ${lastError}`
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to duplicate instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.deleteInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					nodes = [...treeSelections];
				}
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to delete");
				return;
			}


			try {
				let successCount = 0;
				let lastError = null;

				for (const node of nodes) {
					const result = await backend.sendOperation({
						type: "delete_instance",
						nodeId: node.id
					});

					if (result.success) {
						successCount++;
					} else {
						lastError = result.error;
					}
				}

				if (successCount < nodes.length) {
					vscode.window.showWarningMessage(
						`Deleted ${successCount}/${nodes.length} instances. Last error: ${lastError}`
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					nodes = [...treeSelections];
				}
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to copy");
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "copy_instance",
					nodeIds: nodes.map(node => node.id)
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to copy instances: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.pasteInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let targetNodeId: string | null = null;
			if (args.length > 0 && args[0]) {
				targetNodeId = args[0].id;
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					targetNodeId = treeSelections[0].id;
				}
			}

			try {
				const result = await backend.sendOperation({
					type: "paste_instance",
					targetNodeId
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to paste instances: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to paste instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.addInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let parentNode: any = null;
			if (args.length > 0 && args[0]) {
				parentNode = args[0];
			} else {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					parentNode = treeSelections[0];
				}
			}

			if (!parentNode) {
				vscode.window.showErrorMessage("No parent selected to add instance to");
				return;
			}

			const quickPickItems = ROBLOX_CLASS_NAMES.map(className => ({
				label: className,
				iconPath: vscode.Uri.joinPath(context.extensionUri, "assets", `${className}@2x.png`)
			}));

			const selectedItem = await vscode.window.showQuickPick(
				quickPickItems,
				{
					placeHolder: `Select instance type to add to "${parentNode.name}"`,
					matchOnDescription: true
				}
			);

			const className = selectedItem?.label;

			if (!className) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "create_instance",
					parentId: parentNode.id,
					className: className
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to create instance: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create instance: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.handleScriptActivation", async (node: Node) => {
			const nodeId = node.id;

			if (scriptActivationTracker[nodeId]?.timeout) {
				clearTimeout(scriptActivationTracker[nodeId].timeout);
			}

			if (!scriptActivationTracker[nodeId]) {
				scriptActivationTracker[nodeId] = { count: 0, timeout: null };
			}

			scriptActivationTracker[nodeId].count++;

			scriptActivationTracker[nodeId].timeout = setTimeout(() => {
				scriptActivationTracker[nodeId].count = 0;
			}, 300);

			if (scriptActivationTracker[nodeId].count === 2) {
				console.log('Double-click detected, opening script');
				await vscode.commands.executeCommand('verde.openScript', node);
				scriptActivationTracker[nodeId].count = 0;
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.togglePropertiesPanelMode", () => {
			vscode.commands.executeCommand("workbench.view.extension.verdeContainer");
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.openScript", async (node: Node) => {
			if (!node) {
				const treeSelections = explorerView.selection;
				if (treeSelections && treeSelections.length > 0) {
					node = treeSelections[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No script selected");
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = getInstancePath(node, explorerProvider);
				const fileUri = sourcemapParser.findFilePath(instancePath);

				if (fileUri) {
					const document = await vscode.workspace.openTextDocument(fileUri);
					await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
				} else {
					vscode.window.showWarningMessage(`No sourcemap entry found for script: ${node.name}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open script: ${String(error)}`);
			}
		})
	);

	function getInstancePath(node: Node, provider: RobloxExplorerProvider): string[] {
		const path: string[] = [node.name];
		let current = node;

		while (current.parentId) {
			const parent = provider.getNodeById(current.parentId);
			if (!parent) {
				break;
			}
			path.unshift(parent.name);
			current = parent;
		}

		return path;
	}

	const config = vscode.workspace.getConfiguration("verde");
	const autoStart = config.get<boolean>("autoStart", true);

	if (autoStart) {
		try {
			await backend.start();
		} catch (error) {
			vscode.window.showErrorMessage(`verde backend autostart failed: ${String(error)}`);
			outputChannel.show(true);
		}
	}
}

export async function deactivate() {
	if (backend) {
		await backend.stop();
		backend = null;
	}
}
