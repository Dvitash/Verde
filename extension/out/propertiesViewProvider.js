"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertiesViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const propertiesHtml_1 = require("./propertiesHtml");
class PropertiesViewProvider {
    extensionUri;
    static viewType = 'verde.properties';
    webviewView;
    separatePanel;
    backend;
    currentNodeId = null;
    currentNodeName = null;
    currentNodeClassName = null;
    isUsingSeparatePanel = false;
    constructor(backend, extensionUri) {
        this.extensionUri = extensionUri;
        this.backend = backend;
    }
    resolveWebviewView(webviewView, context, _token) {
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
        webviewView.webview.html = (0, propertiesHtml_1.getPropertiesHtml)(this.extensionUri, { showToggleButton: true });
        webviewView.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });
        webviewView.onDidDispose(() => {
            this.webviewView = undefined;
        });
    }
    show(node) {
        this.currentNodeId = node.id;
        this.currentNodeName = node.name;
        this.currentNodeClassName = node.className;
        if (this.isUsingSeparatePanel && this.separatePanel) {
            this.separatePanel.title = `Properties - ${this.currentNodeClassName} "${this.currentNodeName}"`;
            this.loadPropertiesForPanel(this.separatePanel.webview);
        }
        else if (this.webviewView) {
            this.webviewView.show();
            setTimeout(() => {
                this.loadProperties();
            }, 100);
        }
    }
    async loadProperties() {
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
        }
    }
    async handleMessage(message) {
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
                await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to update property: ${error}`);
            }
        }
    }
    togglePanelMode() {
        if (this.isUsingSeparatePanel) {
            if (this.separatePanel) {
                this.separatePanel.dispose();
                this.separatePanel = undefined;
            }
            this.isUsingSeparatePanel = false;
            if (this.webviewView) {
                this.webviewView.webview.html = (0, propertiesHtml_1.getPropertiesHtml)(this.extensionUri, { showToggleButton: true });
                this.webviewView.show();
                setTimeout(() => {
                    this.loadProperties();
                }, 100);
            }
        }
        else {
            this.createSeparatePanel();
        }
    }
    createSeparatePanel() {
        if (this.webviewView) {
            this.webviewView.webview.html = '';
        }
        const panel = vscode.window.createWebviewPanel("verde.properties.panel", `Properties - ${this.currentNodeClassName || "Unknown"} "${this.currentNodeName || "No Selection"}"`, vscode.ViewColumn.Beside, {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, "assets"),
                vscode.Uri.joinPath(this.extensionUri, "resources")
            ],
            retainContextWhenHidden: true,
        });
        this.separatePanel = panel;
        this.isUsingSeparatePanel = true;
        panel.webview.html = (0, propertiesHtml_1.getPropertiesHtml)(this.extensionUri, { showToggleButton: true });
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
                    await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
                }
                catch (error) {
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
    async loadPropertiesForPanel(webview) {
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
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
        }
    }
}
exports.PropertiesViewProvider = PropertiesViewProvider;
//# sourceMappingURL=propertiesViewProvider.js.map