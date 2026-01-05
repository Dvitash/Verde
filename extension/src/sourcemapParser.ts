import * as vscode from "vscode";

interface SourcemapNode {
    name: string;
    className: string;
    children?: SourcemapNode[];
    filePaths?: string[];
}

export class SourcemapParser {
    private sourcemaps: Map<string, { node: SourcemapNode; baseUri: vscode.Uri }> = new Map();

    constructor(private workspaceRoot: vscode.Uri) { }

    async loadSourcemaps(): Promise<void> {
        const config = vscode.workspace.getConfiguration('verde');
        const sourcemapPaths = config.get<string[]>('sourcemapPaths', ['plugin/sourcemap.json']);

        for (const path of sourcemapPaths) {
            try {
                const uri = vscode.Uri.joinPath(this.workspaceRoot, path);
                const content = await vscode.workspace.fs.readFile(uri);
                const sourcemap = JSON.parse(content.toString());
                const baseUri = vscode.Uri.joinPath(uri, '..');
                this.sourcemaps.set(path, { node: sourcemap, baseUri });
            } catch (error) {
                console.warn(`Failed to load sourcemap at ${path}:`, error);
            }
        }
    }

    findFilePath(instancePath: string[]): vscode.Uri | null {
        for (const [sourcemapPath, sourcemapData] of this.sourcemaps) {
            const filePath = this.searchNode(sourcemapData.node, instancePath, 0);
            if (filePath) {
                return vscode.Uri.joinPath(sourcemapData.baseUri, filePath);
            }
        }
        return null;
    }

    private searchNode(node: SourcemapNode, path: string[], index: number): string | null {
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
