import * as vscode from "vscode";
import { VerdeBackend } from "./backend";
import { getPropertiesHtml, PropertiesHtmlOptions } from "./propertiesHtml";

import { Node } from "./robloxExplorerProvider";

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'verde.properties';

	private webviewView: vscode.WebviewView | undefined;
	private separatePanel: vscode.WebviewPanel | undefined;
	private backend: VerdeBackend;
	private currentNodeId: string | null = null;
	private currentNodeName: string | null = null;
	private currentNodeClassName: string | null = null;
	private isUsingSeparatePanel: boolean = false;

	constructor(backend: VerdeBackend, private readonly extensionUri: vscode.Uri) {
		this.backend = backend;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webviewView = webviewView;

		if (this.currentNodeId) {
			setTimeout(() => {
				this.loadProperties();
			}, 100);
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "assets"),
				vscode.Uri.joinPath(this.extensionUri, "resources")
			]
		};

		webviewView.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });

		webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleMessage(message);
		});

		webviewView.onDidDispose(() => {
			this.webviewView = undefined;
		});
	}

	public show(node: Node): void {
		this.currentNodeId = node.id;
		this.currentNodeName = node.name;
		this.currentNodeClassName = node.className;
		if (this.isUsingSeparatePanel && this.separatePanel) {
			this.separatePanel.title = `Properties - ${this.currentNodeClassName} - ${this.currentNodeName}`;
			this.loadPropertiesForPanel(this.separatePanel.webview);
		} else if (this.webviewView) {
			setTimeout(() => {
				this.loadProperties();
			}, 100);
		}
	}

	private async loadProperties(): Promise<void> {
		if (!this.currentNodeId || !this.webviewView) {
			return;
		}

		try {
			const properties = await this.backend.getProperties(this.currentNodeId);

			this.webviewView.webview.postMessage({
				type: "updateProperties",
				properties,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
		}
	}


	private async handleMessage(message: any): Promise<void> {
		if (message.type === "navigateToInstance") {
			vscode.commands.executeCommand("verde.navigateToInstance", message.instanceId);
			return;
		}

		if (message.type === "togglePanelMode") {
			this.togglePanelMode();
			return;
		}

		if (this.currentNodeId && message.type === "setProperty") {
			try {
				const properties = await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
				this.webviewView!.webview.postMessage({
					type: "updateProperties",
					properties,
					nodeName: this.currentNodeName,
					nodeClassName: this.currentNodeClassName,
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to update property: ${error}`);
			}
		}
	}

	private togglePanelMode(): void {
		if (this.isUsingSeparatePanel) {
			if (this.separatePanel) {
				this.separatePanel.dispose();
				this.separatePanel = undefined;
			}
			this.isUsingSeparatePanel = false;
			if (this.webviewView) {
				this.webviewView.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });
				this.webviewView.show();
				setTimeout(() => {
					this.loadProperties();
				}, 100);
			}
		} else {
			this.createSeparatePanel();
		}
	}

	private createSeparatePanel(): void {
		if (this.webviewView) {
			this.webviewView.webview.html = '';
		}

		const panel = vscode.window.createWebviewPanel(
			"verde.properties.panel",
			`Properties - ${this.currentNodeClassName || "Unknown"} - ${this.currentNodeName || "No Selection"}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.extensionUri, "assets"),
					vscode.Uri.joinPath(this.extensionUri, "resources")
				],
				retainContextWhenHidden: true,
			}
		);

		this.separatePanel = panel;
		this.isUsingSeparatePanel = true;

		panel.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });

		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === "navigateToInstance") {
				vscode.commands.executeCommand("verde.navigateToInstance", message.instanceId);
				return;
			}

			if (message.type === "togglePanelMode") {
				this.togglePanelMode();
				return;
			}

			if (this.currentNodeId && message.type === "setProperty") {
				try {
					const properties = await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
					panel.webview.postMessage({
						type: "updateProperties",
						properties,
						nodeName: this.currentNodeName,
						nodeClassName: this.currentNodeClassName,
					});
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to update property: ${error}`);
				}
			}
		});

		panel.onDidDispose(() => {
			this.separatePanel = undefined;
			this.isUsingSeparatePanel = false;
			if (this.webviewView) {
				this.webviewView.show();
				setTimeout(() => {
					this.loadProperties();
				}, 100);
			}
		});

		if (this.currentNodeId) {
			this.loadPropertiesForPanel(panel.webview);
		}

		panel.reveal();
	}


	private async loadPropertiesForPanel(webview: vscode.Webview): Promise<void> {
		if (!this.currentNodeId) {
			return;
		}

		try {
			const properties = await this.backend.getProperties(this.currentNodeId);
			webview.postMessage({
				type: "updateProperties",
				properties,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
		}
	}
}
