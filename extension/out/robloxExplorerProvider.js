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
exports.RobloxExplorerProvider = void 0;
const vscode = __importStar(require("vscode"));
const instanceSorter_1 = require("./instanceSorter");
const dragAndDropController_1 = require("./dragAndDropController");
class RobloxExplorerProvider {
    extensionUri;
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    nodesById = new Map();
    rootIds = [];
    backend = null;
    sorter;
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this.sorter = new instanceSorter_1.InstanceSorter();
    }
    setBackend(backend) {
        this.backend = backend;
    }
    getNodeById(id) {
        return this.nodesById.get(id);
    }
    async performOperation(operation) {
        if (!this.backend) {
            throw new Error("Backend not set");
        }
        return this.backend.sendOperation(operation);
    }
    getDragAndDropController() {
        return new dragAndDropController_1.DragAndDropController(this);
    }
    setSnapshot(snapshot) {
        const nextNodesById = new Map();
        for (const node of snapshot.nodes) {
            nextNodesById.set(node.id, node);
        }
        this.nodesById = nextNodesById;
        this.rootIds = snapshot.rootIds;
        this.onDidChangeTreeDataEmitter.fire();
    }
    getTreeItem(element) {
        const treeItem = new vscode.TreeItem(element.name, element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        treeItem.id = element.id;
        treeItem.tooltip = `${element.name} (${element.className})`;
        treeItem.iconPath = this.getIconForClassName(element.className);
        if (this.isScriptClass(element.className)) {
            treeItem.command = {
                command: 'verde.handleScriptActivation',
                arguments: [element],
                title: 'Handle Script Activation'
            };
        }
        return treeItem;
    }
    getChildren(element) {
        let nodes;
        if (!element) {
            nodes = this.rootIds
                .map((rootId) => this.nodesById.get(rootId))
                .filter((node) => node !== undefined);
        }
        else {
            nodes = element.children
                .map((childId) => this.nodesById.get(childId))
                .filter((node) => node !== undefined);
        }
        return this.sorter.sortNodes(nodes);
    }
    getParent(element) {
        if (!element.parentId) {
            return undefined;
        }
        return this.nodesById.get(element.parentId);
    }
    getIconForClassName(className) {
        return vscode.Uri.joinPath(this.extensionUri, "assets", `${className}@3x.png`);
    }
    isScriptClass(className) {
        return className === "Script" || className === "LocalScript" || className === "ModuleScript";
    }
}
exports.RobloxExplorerProvider = RobloxExplorerProvider;
//# sourceMappingURL=robloxExplorerProvider.js.map