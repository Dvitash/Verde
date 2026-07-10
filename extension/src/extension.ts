import * as vscode from "vscode";
import { RobloxExplorerProvider, Node } from "./robloxExplorerProvider";
import { ExplorerViewProvider } from "./explorerViewProvider";
import { VerdeBackend } from "./backend";
import { PropertiesViewProvider } from "./propertiesViewProvider";
import { getClassNames, initClassNames } from "./robloxClasses";
import { SourcemapParser } from "./sourcemapParser";
import { isScriptClass, buildDottedPath } from "./utils";
import { InstanceHistory, HistoryEntry } from "./instanceHistory";
import { ContextMenuRegistry } from "./contextMenuRegistry";
import { LuauExecutionService } from "./luauExecutionService";
import { VerdeApi } from "./api";
import { invalidateCustomIconCache, resolveIconUri } from "./iconResolver";

import * as fzy from "fzy.js";

let backend: VerdeBackend | null = null;
let sourcemapParser: SourcemapParser;
let propertiesViewProvider: PropertiesViewProvider;
let explorerViewProvider: ExplorerViewProvider;
let instanceHistory: InstanceHistory;
type QuickPickItemWithNode = vscode.QuickPickItem & { node: Node };
let cachedQuickPickItems: QuickPickItemWithNode[] = [];
let cachedSearchStrings: string[] = [];
let onQuickPickCacheRebuilt: (() => void) | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<VerdeApi> {
	const outputChannel = vscode.window.createOutputChannel("Verde Backend");
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(statusBarItem);

	const explorerProvider = new RobloxExplorerProvider();
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || context.extensionUri;
	sourcemapParser = new SourcemapParser(workspaceRoot);
	instanceHistory = new InstanceHistory(10);
	const showNodeInProperties = (node: Node) => {
		propertiesViewProvider.show(node);

		const instancePath = getInstancePath(node);
		instanceHistory.add(node, instancePath);
	};

	const revealOnNextSnapshot = (
		editorUriToMatch: string | null,
		lookup: () => Node | undefined,
		onMissing?: () => void,
		searchQuery?: string,
	) => {
		if (!backend) return;

		const finishReveal = () => {
			if (editorUriToMatch !== null) {
				const current = vscode.window.activeTextEditor?.document.uri.toString();
				if (current !== editorUriToMatch) return;
			}
			const refreshed = lookup();
			if (refreshed) {
				explorerViewProvider.reveal(refreshed);
				if (editorUriToMatch !== null) {
					vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
				}
			} else if (onMissing) {
				onMissing();
			}
		};

		const trySearchFallback = (): boolean => {
			if (!backend || !searchQuery || searchQuery.length < 2) return false;
			if (explorerViewProvider.getFullSyncStatus() !== 'too_big') return false;
			if (!backend.requestSearch(searchQuery)) return false;
			waitForExplorerCondition(() => lookup() !== undefined).then(finishReveal);
			return true;
		};

		const syncStatus = explorerViewProvider.getFullSyncStatus();
		if (syncStatus !== 'unknown') {
			const node = lookup();
			if (node) explorerViewProvider.reveal(node);
			else if (!trySearchFallback() && onMissing) onMissing();
			return;
		}
		backend.requestSnapshot(true).then(finishReveal).catch(() => {
			if (!trySearchFallback() && onMissing) onMissing();
		});
	};

	const buildQuickPickItem = async (node: Node, detail: string): Promise<vscode.QuickPickItem & { node: Node }> => {
		return {
			label: node.name,
			description: node.className,
			detail,
			iconPath: await resolveIconUri(context.extensionUri, node.className),
			alwaysShow: true,
			node
		};
	};

	const addNodesToQuickPickCache = async (nodes: Node[], pathCache: Map<string, string>) => {
		for (const node of nodes) {
			const detail = dottedPath(node, pathCache);
			cachedSearchStrings.push(detail);
			cachedQuickPickItems.push(await buildQuickPickItem(node, detail));
		}
	};

	const rebuildQuickPickCache = async () => {
		cachedSearchStrings = [];
		cachedQuickPickItems = [];
		await addNodesToQuickPickCache(explorerProvider.getAllNodes(), new Map<string, string>());
		if (onQuickPickCacheRebuilt) onQuickPickCacheRebuilt();
	};

	const appendQuickPickCache = async (added: Node[]) => {
		if (added.length === 0) return;
		await addNodesToQuickPickCache(added, new Map<string, string>());
		if (onQuickPickCacheRebuilt) onQuickPickCacheRebuilt();
	};

	backend = new VerdeBackend(outputChannel, statusBarItem, (snapshot, isFull) => {
		explorerProvider.setSnapshot(snapshot, isFull);
		instanceHistory.updateNodeReferences((id: string) => explorerProvider.getNodeById(id));
		void rebuildQuickPickCache();
		explorerViewProvider?.notifySnapshotReplaced();
		if (isFull) {
			explorerViewProvider?.markFullSyncSucceeded();
		} else {
			explorerViewProvider?.markPartialSnapshot();
		}
	}, (ops, addedRootIds) => {
		explorerViewProvider?.notifyDelta(ops);
		const { added, needsRebuild, hasChildrenCleared } = explorerProvider.applyDelta(ops, addedRootIds);
		if (hasChildrenCleared.length > 0) {
			explorerViewProvider?.notifyHasChildrenCleared(hasChildrenCleared);
		}
		instanceHistory.updateNodeReferences((id: string) => explorerProvider.getNodeById(id));
		if (needsRebuild) {
			void rebuildQuickPickCache();
		} else if (added.length > 0) {
			void appendQuickPickCache(added);
		}
	}, () => {
		explorerProvider.setSnapshot({ nodes: [], rootIds: [] });
		instanceHistory.clear();
		cachedQuickPickItems = [];
		cachedSearchStrings = [];
		explorerViewProvider?.resetFullSyncStatus();
		explorerViewProvider?.notifySnapshotReplaced();
	}, (query, nodes) => {
		const { added, needsRebuild } = explorerProvider.mergeSearchResults(nodes);
		instanceHistory.updateNodeReferences((id: string) => explorerProvider.getNodeById(id));
		if (needsRebuild) {
			void rebuildQuickPickCache();
		} else {
			void appendQuickPickCache(added);
		}
		explorerViewProvider?.handleSearchResults(query, nodes);
	}, () => {
		explorerViewProvider?.markFullSyncTooBig();
	});

	const sourcemapPath = vscode.workspace.getConfiguration('verde').get('sourcemapPath', 'sourcemap.json');
	const watcher = vscode.workspace.createFileSystemWatcher(`**/${sourcemapPath}`);
	watcher.onDidChange(() => sourcemapParser.loadSourcemaps());
	watcher.onDidCreate(() => sourcemapParser.loadSourcemaps());
	watcher.onDidDelete(() => sourcemapParser.loadSourcemaps());
	context.subscriptions.push(watcher);

	const syncScriptDisabledState = (nodeId: string, propertiesData: any) => {
		const node = explorerProvider.getNodeById(nodeId);
		if (!node || !isScriptClass(node.className)) return;

		const properties = Array.isArray(propertiesData.properties) ? propertiesData.properties : [];
		const enabledProperty = properties.find((property: any) => property.name === "Enabled");
		if (typeof enabledProperty?.value === "boolean") {
			const next = !enabledProperty.value;
			explorerProvider.setNodeDisabled(nodeId, next);
			explorerViewProvider?.notifyDisabledChanged(nodeId, next);
			return;
		}

		const disabledProperty = properties.find((property: any) => property.name === "Disabled");
		if (typeof disabledProperty?.value === "boolean") {
			explorerProvider.setNodeDisabled(nodeId, disabledProperty.value);
			explorerViewProvider?.notifyDisabledChanged(nodeId, disabledProperty.value);
		}
	};

	propertiesViewProvider = new PropertiesViewProvider(backend, context.extensionUri, syncScriptDisabledState);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PropertiesViewProvider.viewType, propertiesViewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	const contextMenuRegistry = new ContextMenuRegistry(outputChannel);
	const luauExecutionService = new LuauExecutionService(backend, context.globalState);
	explorerViewProvider = new ExplorerViewProvider(context.extensionUri, explorerProvider, backend, contextMenuRegistry);
	backend.setPropertyUpdateCallback(syncScriptDisabledState);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ExplorerViewProvider.viewType, explorerViewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	void initClassNames(context, () => explorerViewProvider.postClassNames());

	context.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(() => {
			explorerViewProvider.refreshWebviewHtml();
			propertiesViewProvider.refreshWebviewHtml();
		})
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration("verde.iconDirectory")) {
				return;
			}

			invalidateCustomIconCache();
			explorerViewProvider.refreshWebviewHtml();
			void initClassNames(context, () => explorerViewProvider.postClassNames());
			void rebuildQuickPickCache();
		})
	);

	explorerViewProvider.onSelectionChanged((selection) => {
		if (selection.length !== 1) {
			return;
		}

		showNodeInProperties(selection[0]);
	});

	explorerViewProvider.onNodeActivated((node) => {
		showNodeInProperties(node);
	});

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor || !editor.document) {
				return;
			}

			if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
				return;
			}

			if (!explorerViewProvider.isVisible()) {
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = sourcemapParser.findInstancePath(editor.document.uri);

				if (instancePath) {
					const node = explorerProvider.getNodeByInstancePath(instancePath);
					if (node) {
						explorerViewProvider.reveal(node);
						// force-refocus the text editor
						await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
					} else if (backend) {
						revealOnNextSnapshot(editor.document.uri.toString(), () =>
							explorerProvider.getNodeByInstancePath(instancePath),
							undefined, instancePath[instancePath.length - 1]);
					}
				}
			} catch (error) {
				console.debug('Failed to reveal script node in explorer:', error);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('verde.navigateToInstance', async (instanceId: string) => {
			if (!explorerViewProvider.isVisible()) {
				return;
			}

			const node = explorerProvider.getNodeById(instanceId);
			if (node) {
				explorerViewProvider.reveal(node);
			} else if (backend) {
				revealOnNextSnapshot(null, () => explorerProvider.getNodeById(instanceId), () => {
					vscode.window.showWarningMessage(`Instance ${instanceId} not found in explorer`);
				});
			} else {
				vscode.window.showWarningMessage(`Instance ${instanceId} not found in explorer`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('verde.goToInstance', async () => {
			let fullSyncUnavailable = explorerViewProvider.getFullSyncStatus() === 'too_big';
			const quickPick = vscode.window.createQuickPick<QuickPickItemWithNode>();
			quickPick.placeholder = 'Type to search instances...';
			quickPick.matchOnDetail = true;

			let debounceTimer: NodeJS.Timeout | undefined;
			let lastRawQuery = '';
			let serverSearchActive = false;

			const sendServerSearch = (query: string) => {
				if (!backend) return;
				backend.requestSearch(query);
				serverSearchActive = true;
			};

			const clearServerSearch = () => {
				if (serverSearchActive && backend) {
					serverSearchActive = false;
					if (!explorerViewProvider.reissueServerSearch()) {
						backend.requestSearch('');
					}
				}
			};

			const handleFullSnapshotUnavailable = () => {
				if (explorerViewProvider.getFullSyncStatus() !== 'too_big') return;
				fullSyncUnavailable = true;
				if (backend && lastRawQuery.length >= 2) {
					sendServerSearch(lastRawQuery);
				}
			};

			if (backend && explorerViewProvider.getFullSyncStatus() === 'unknown') {
				backend.requestSnapshot(true).then(snapshot => {
					if (snapshot === null) handleFullSnapshotUnavailable();
				}).catch(handleFullSnapshotUnavailable);
			}

			const filterItems = (query: string) => {
				const scored: { item: vscode.QuickPickItem & { node: Node }; score: number }[] = [];

				for (let i = 0; i < cachedSearchStrings.length; i++) {
					const str = cachedSearchStrings[i];
					if (fzy.hasMatch(query, str)) {
						scored.push({
							item: cachedQuickPickItems[i],
							score: fzy.score(query, str)
						});
					}
				}

				scored.sort((a, b) => b.score - a.score);

				quickPick.items = scored.slice(0, 50).map(r => r.item);
				quickPick.busy = false;
			};

			quickPick.onDidChangeValue(value => {
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}

				const rawQuery = value.trim();
				const query = rawQuery.replace(/\s+/g, '.');
				if (!query) {
					lastRawQuery = '';
					clearServerSearch();
					quickPick.items = [];
					quickPick.busy = false;
					return;
				}
				quickPick.busy = true;
				lastRawQuery = rawQuery;
				debounceTimer = setTimeout(() => {
					if (fullSyncUnavailable && backend) {
						if (rawQuery.length >= 2) sendServerSearch(rawQuery);
						else clearServerSearch();
					}
					filterItems(query);
				}, 50);
			});

			const cacheRebuiltListener = () => {
				if (lastRawQuery) filterItems(lastRawQuery.replace(/\s+/g, '.'));
			};
			onQuickPickCacheRebuilt = cacheRebuiltListener;

			quickPick.onDidAccept(async () => {
				const selected = quickPick.selectedItems[0];
				if (!selected) {
					quickPick.hide();
					return;
				}

				const node = selected.node;
				const isScript = isScriptClass(node.className);

				const instancePath = getInstancePath(node);
				instanceHistory.add(node, instancePath);

				try {
					explorerViewProvider.reveal(node);
				} catch (error) {
					console.debug('Failed to reveal node in explorer:', error);
				}

				if (isScript) {
					await vscode.commands.executeCommand('verde.openScript', node);
				}

				quickPick.hide();
			});

			quickPick.onDidHide(() => {
				if (onQuickPickCacheRebuilt === cacheRebuiltListener) {
					onQuickPickCacheRebuilt = null;
				}
				clearServerSearch();
				quickPick.dispose();
			});
			quickPick.show();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.refreshExplorer", async () => {
			if (backend) {
				await backend.requestSnapshot(true).catch((error: unknown) => {
					if (error instanceof Error && error.message === "snapshot_request_abandoned") {
						return;
					}
					return backend?.requestSnapshot(false);
				});
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.collapseAll", () => {
			explorerViewProvider.collapseAll();
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
			let newNameArg: string | undefined;
			if (args.length > 0 && args[0]) {
				node = args[0];
			}
			if (args.length > 1 && typeof args[1] === "string") {
				newNameArg = args[1];
			}
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) node = sel[0];
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected to rename");
				return;
			}

			// inline rename from webview passes newName; otherwise start inline rename in webview
			if (newNameArg !== undefined) {
				const newName = newNameArg.trim();
				if (!newName) return;
				const isScript = isScriptClass(node.className);
				let oldFileUri: vscode.Uri | null = null;
				if (isScript) {
					await sourcemapParser.loadSourcemaps();
					const oldInstancePath = getInstancePath(node);
					oldFileUri = sourcemapParser.findFilePath(oldInstancePath);
				}
				try {
					const result = await backend.sendOperation({
						type: "rename_instance",
						nodeId: node.id,
						newName
					});
					if (!result.success) {
						vscode.window.showErrorMessage(`Failed to rename instance: ${result.error}`);
					} else if (isScript) {
						const renameReflected = await waitForExplorerCondition(
							() => explorerProvider.getNodeById(node.id)?.name === newName);
						await sourcemapParser.loadSourcemaps();
						const updatedNode = explorerProvider.getNodeById(node.id);
						if (updatedNode && renameReflected) {
							if (oldFileUri) {
								const tabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
								const tabToClose = tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === oldFileUri!.toString());
								if (tabToClose) await vscode.window.tabGroups.close(tabToClose);
							}
							const newInstancePath = getInstancePath(updatedNode);
							const newFileUri = sourcemapParser.findFilePath(newInstancePath);
							if (newFileUri) {
								const document = await vscode.workspace.openTextDocument(newFileUri);
								await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
							}
						}
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to rename instance: ${String(error)}`);
				}
				return;
			}

			explorerViewProvider.startRename(node.id);
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
				nodes = [...explorerViewProvider.getSelection()];
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
				nodes = [...explorerViewProvider.getSelection()];
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to delete");
				return;
			}


			try {
				let successCount = 0;
				let lastError = null;
				const scriptFileUris: vscode.Uri[] = [];

				for (const node of nodes) {
					if (isScriptClass(node.className)) {
						const instancePath = getInstancePath(node);
						const fileUri = sourcemapParser.findFilePath(instancePath);
						if (fileUri) {
							scriptFileUris.push(fileUri);
						}
					}
				}

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

				for (const fileUri of scriptFileUris) {
					const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
					if (document) {
						await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
					}
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
				nodes = [...explorerViewProvider.getSelection()];
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
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					targetNodeId = sel[0].id;
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

			if (!explorerViewProvider.isVisible()) {
				return;
			}

			let parentNode: any = null;
			if (args.length > 0 && args[0]) {
				parentNode = args[0];
			} else {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					parentNode = sel[0];
				}
			}

			if (!parentNode) {
				vscode.window.showErrorMessage("No parent selected to add instance to");
				return;
			}

			const quickPickItems = await Promise.all(getClassNames().map(async className => ({
				label: className,
				iconPath: await resolveIconUri(context.extensionUri, className)
			})));

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
				} else if (result.data && typeof result.data === 'string') {
					const newNodeId = result.data;
					backend.requestChildren([parentNode.id]);
					await waitForExplorerCondition(() => explorerProvider.getNodeById(newNodeId) !== undefined);
					const newNode = explorerProvider.getNodeById(newNodeId);
					if (newNode) {
						explorerViewProvider.reveal(newNode);

						if (isScriptClass(newNode.className)) {
							waitForScriptInSourcemap(newNode, 2000).catch(error => {
								console.debug('Failed to wait for script in sourcemap:', error);
							});
						}
					}
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create instance: ${String(error)}`);
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
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No script selected");
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = getInstancePath(node);
				const fileUri = sourcemapParser.findFilePath(instancePath);

				if (fileUri) {
					const document = await vscode.workspace.openTextDocument(fileUri);
					await vscode.window.showTextDocument(document, {
						viewColumn: vscode.ViewColumn.One,
						preview: false
					});
				} else {
					vscode.window.showWarningMessage(`No sourcemap entry found for script: ${node.name}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open script: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyRobloxPath", async (node: Node) => {
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected");
				return;
			}

			try {
				const robloxPath = getInstancePath(node).join(".");
				await vscode.env.clipboard.writeText(robloxPath);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy Roblox path: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyFilePath", async (node: Node) => {
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected");
				return;
			}

			if (!isScriptClass(node.className)) {
				vscode.window.showErrorMessage("Selected instance is not a script");
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = getInstancePath(node);
				const fileUri = sourcemapParser.findFilePath(instancePath);

				if (fileUri) {
					const filePath = vscode.workspace.asRelativePath(fileUri);
					await vscode.env.clipboard.writeText(filePath);
				} else {
					vscode.window.showErrorMessage(`No file path found for script: ${node.name}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy file path: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.undo", async () => {
			if (!backend) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "undo"
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to undo: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to undo: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.redo", async () => {
			if (!backend) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "redo"
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to redo: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to redo: ${String(error)}`);
			}
		})
	);

	async function waitForExplorerCondition(predicate: () => boolean, timeoutMs: number = 3000): Promise<boolean> {
		if (predicate()) {
			return true;
		}
		return new Promise<boolean>(resolve => {
			let settled = false;
			const finish = (result: boolean) => {
				if (settled) return;
				settled = true;
				dispose();
				clearTimeout(timer);
				resolve(result);
			};
			const dispose = explorerProvider.onChange(() => {
				if (predicate()) finish(true);
			});
			const timer = setTimeout(() => finish(predicate()), timeoutMs);
		});
	}

	function getInstancePath(node: Node): string[] {
		const path: string[] = [node.name];
		let current = node;

		while (current.parentId) {
			const parent = explorerProvider.getNodeById(current.parentId);
			if (!parent) {
				break;
			}
			path.unshift(parent.name);
			current = parent;
		}

		return path;
	}

	function dottedPath(node: Node, cache: Map<string, string>): string {
		return buildDottedPath(node, (id) => explorerProvider.getNodeById(id), cache);
	}

	async function waitForScriptInSourcemap(node: Node, timeoutMs: number = 2000): Promise<boolean> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			await sourcemapParser.loadSourcemaps();
			const instancePath = getInstancePath(node);
			const fileUri = sourcemapParser.findFilePath(instancePath);

			if (fileUri) {
				try {
					await vscode.commands.executeCommand("verde.openScript", node);
					return true;
				} catch (error) {
					console.debug('Failed to open script document:', error);
					return false;
				}
			}

			await new Promise(resolve => setTimeout(resolve, 100));
		}

		return false;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.revokeLuauConsent", async () => {
			type RevokePick = vscode.QuickPickItem & { revokeAll?: true; extensionId?: string };

			const ids = luauExecutionService.listConsentedExtensions();
			if (ids.length === 0) {
				vscode.window.showInformationMessage("Verde: no extensions currently have Luau execution consent.");
				return;
			}

			const noun = ids.length === 1 ? "extension" : "extensions";
			const picks: RevokePick[] = [
				{ label: "$(trash) Revoke all", description: `${ids.length} ${noun}`, revokeAll: true },
				{ label: "Individual extensions", kind: vscode.QuickPickItemKind.Separator },
				...ids.map((id): RevokePick => {
					const ext = vscode.extensions.getExtension(id);
					const displayName =
						(ext?.packageJSON as { displayName?: string } | undefined)?.displayName ||
						(ext?.packageJSON as { name?: string } | undefined)?.name ||
						id;
					return { label: displayName, description: id, extensionId: id };
				}),
			];

			const choice = await vscode.window.showQuickPick<RevokePick>(picks, {
				placeHolder: "Revoke 'Always Allow' for which extension?",
				canPickMany: false,
			});
			if (!choice) {
				return;
			}

			if (choice.revokeAll) {
				const confirm = await vscode.window.showWarningMessage(
					`Revoke Luau execution consent for all ${ids.length} ${noun}?`,
					{ modal: true },
					"Revoke all",
				);
				if (confirm !== "Revoke all") {
					return;
				}
				await luauExecutionService.revokeAllConsents();
				vscode.window.showInformationMessage(`Verde: revoked Luau consent for ${ids.length} ${noun}.`);
				return;
			}

			if (choice.extensionId) {
				await luauExecutionService.revokeConsent(choice.extensionId);
				vscode.window.showInformationMessage(`Verde: revoked Luau consent for "${choice.label}".`);
			}
		})
	);

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

	return {
		registerContextMenuItem: (item) => contextMenuRegistry.register(item),
		executeLuau: (opts) => luauExecutionService.execute(opts),
	};
}

export async function deactivate() {
	if (backend) {
		await backend.stop();
		backend = null;
	}
}
