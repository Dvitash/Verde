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
class RobloxExplorerDragAndDropController {
    provider;
    dropMimeTypes = ["application/vnd.code.tree.robloxexplorer"];
    dragMimeTypes = ["application/vnd.code.tree.robloxexplorer"];
    constructor(provider) {
        this.provider = provider;
    }
    async handleDrag(source, dataTransfer) {
        dataTransfer.set("application/vnd.code.tree.robloxexplorer", new vscode.DataTransferItem(source));
    }
    async handleDrop(target, dataTransfer) {
        const transferItem = dataTransfer.get("application/vnd.code.tree.robloxexplorer");
        if (!transferItem) {
            return;
        }
        const sourceNodes = transferItem.value;
        if (sourceNodes.length !== 1) {
            return;
        }
        const sourceNode = sourceNodes[0];
        if (target && this.isDescendantOf(target, sourceNode)) {
            vscode.window.showErrorMessage("Cannot move a node to one of its descendants");
            return;
        }
        if (target && target.id === sourceNode.id) {
            return;
        }
        const newParentId = target ? target.id : null;
        try {
            const result = await this.provider.performOperation({
                type: "move_node",
                nodeId: sourceNode.id,
                newParentId: newParentId
            });
            if (!result.success) {
                vscode.window.showErrorMessage(`Failed to move node: ${result.error}`);
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to move node: ${String(error)}`);
        }
    }
    isDescendantOf(node, potentialAncestor) {
        let current = node;
        while (current.parentId) {
            if (current.parentId === potentialAncestor.id) {
                return true;
            }
            const parent = this.provider.getNodeById(current.parentId);
            if (!parent) {
                break;
            }
            current = parent;
        }
        return false;
    }
}
class RobloxExplorerProvider {
    extensionUri;
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    nodesById = new Map();
    rootIds = [];
    backend = null;
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
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
        return new RobloxExplorerDragAndDropController(this);
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
        return nodes.sort((a, b) => {
            const aServiceOrder = this.getServiceOrder(a.className);
            const bServiceOrder = this.getServiceOrder(b.className);
            const aIsService = aServiceOrder !== -1;
            const bIsService = bServiceOrder !== -1;
            const aIsSpecial = a.className === "Camera" || a.className === "Terrain";
            const bIsSpecial = b.className === "Camera" || b.className === "Terrain";
            const aIsFolder = a.className === "Folder";
            const bIsFolder = b.className === "Folder";
            if (aIsService && bIsService) {
                return aServiceOrder - bServiceOrder;
            }
            if (aIsService && !bIsService) {
                return -1;
            }
            if (!aIsService && bIsService) {
                return 1;
            }
            if (aIsSpecial && bIsSpecial) {
                if (a.className === "Camera") {
                    return -1;
                }
                if (b.className === "Camera") {
                    return 1;
                }
                return 0;
            }
            if (aIsSpecial && !bIsSpecial) {
                return -1;
            }
            if (!aIsSpecial && bIsSpecial) {
                return 1;
            }
            // Folders third, alphabetically
            if (aIsFolder && !bIsFolder) {
                return -1;
            }
            if (!aIsFolder && bIsFolder) {
                return 1;
            }
            // Everything else alphabetically
            return a.name.localeCompare(b.name);
        });
    }
    getIconForClassName(className) {
        return vscode.Uri.joinPath(this.extensionUri, "media", `${className}@3x.png`);
    }
    isScriptClass(className) {
        return className === "Script" || className === "LocalScript" || className === "ModuleScript";
    }
    getServiceOrder(className) {
        const serviceOrder = [
            "Workspace",
            "Players",
            "Lighting",
            "MaterialService",
            "ReplicatedFirst",
            "ReplicatedStorage",
            "ServerScriptService",
            "ServerStorage",
            "StarterGui",
            "StarterPack",
            "StarterPlayer",
            "Teams",
            "SoundService",
            "TextChatService",
            "TestService",
            "LocalizationService",
            "VoiceChatService",
            "VRService"
        ];
        const index = serviceOrder.indexOf(className);
        return index === -1 ? -1 : index;
    }
}
exports.RobloxExplorerProvider = RobloxExplorerProvider;
//# sourceMappingURL=robloxExplorerProvider.js.map