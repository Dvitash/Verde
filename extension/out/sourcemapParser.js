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
exports.SourcemapParser = void 0;
const vscode = __importStar(require("vscode"));
class SourcemapParser {
    workspaceRoot;
    sourcemaps = new Map();
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
    }
    async loadSourcemaps() {
        const config = vscode.workspace.getConfiguration('verde');
        const sourcemapPaths = config.get('sourcemapPaths', ['plugin/sourcemap.json']);
        for (const path of sourcemapPaths) {
            try {
                const uri = vscode.Uri.joinPath(this.workspaceRoot, path);
                const content = await vscode.workspace.fs.readFile(uri);
                const sourcemap = JSON.parse(content.toString());
                const baseUri = vscode.Uri.joinPath(uri, '..');
                this.sourcemaps.set(path, { node: sourcemap, baseUri });
            }
            catch (error) {
                console.warn(`Failed to load sourcemap at ${path}:`, error);
            }
        }
    }
    findFilePath(instancePath) {
        for (const [sourcemapPath, sourcemapData] of this.sourcemaps) {
            const filePath = this.searchNode(sourcemapData.node, instancePath, 0);
            if (filePath) {
                return vscode.Uri.joinPath(sourcemapData.baseUri, filePath);
            }
        }
        return null;
    }
    searchNode(node, path, index) {
        if (index >= path.length) {
            return node.filePaths?.[0] || null;
        }
        if (!node.children) {
            return null;
        }
        for (const child of node.children) {
            if (child.name === path[index]) {
                return this.searchNode(child, path, index + 1);
            }
        }
        return null;
    }
}
exports.SourcemapParser = SourcemapParser;
//# sourceMappingURL=sourcemapParser.js.map