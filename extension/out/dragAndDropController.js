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
exports.DragAndDropController = void 0;
const vscode = __importStar(require("vscode"));
class DragAndDropController {
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
exports.DragAndDropController = DragAndDropController;
//# sourceMappingURL=dragAndDropController.js.map