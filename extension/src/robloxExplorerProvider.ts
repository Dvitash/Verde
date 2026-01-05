import * as vscode from "vscode";
import { VerdeBackend, Operation } from "./backend";
import { InstanceSorter, SortableNode } from "./instanceSorter";

export type Node = {
	id: string;
	name: string;
	className: string;
	parentId: string | null;
	children: string[];
};

export type Snapshot = {
	rootIds: string[];
	nodes: Node[];
};

class RobloxExplorerDragAndDropController implements vscode.TreeDragAndDropController<Node> {
	public readonly dropMimeTypes = ["application/vnd.code.tree.robloxexplorer"];
	public readonly dragMimeTypes = ["application/vnd.code.tree.robloxexplorer"];

	constructor(private readonly provider: RobloxExplorerProvider) { }

	public async handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): Promise<void> {
		dataTransfer.set("application/vnd.code.tree.robloxexplorer", new vscode.DataTransferItem(source));
	}

	public async handleDrop(target: Node | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
		const transferItem = dataTransfer.get("application/vnd.code.tree.robloxexplorer");
		if (!transferItem) {
			return;
		}

		const sourceNodes = transferItem.value as Node[];
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
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to move node: ${String(error)}`);
		}
	}

	private isDescendantOf(node: Node, potentialAncestor: Node): boolean {
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

export class RobloxExplorerProvider implements vscode.TreeDataProvider<Node> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<Node | undefined | null | void>();
	public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	private nodesById: Map<string, Node> = new Map();
	private rootIds: string[] = [];
	private backend: VerdeBackend | null = null;
	private sorter: InstanceSorter;

	constructor(private readonly extensionUri: vscode.Uri) {
		this.sorter = new InstanceSorter();
	}

	public setBackend(backend: VerdeBackend): void {
		this.backend = backend;
	}

	public getNodeById(id: string): Node | undefined {
		return this.nodesById.get(id);
	}

	public async performOperation(operation: Operation) {
		if (!this.backend) {
			throw new Error("Backend not set");
		}
		return this.backend.sendOperation(operation);
	}

	public getDragAndDropController(): vscode.TreeDragAndDropController<Node> {
		return new RobloxExplorerDragAndDropController(this);
	}

	public setSnapshot(snapshot: Snapshot): void {
		const nextNodesById = new Map<string, Node>();

		for (const node of snapshot.nodes) {
			nextNodesById.set(node.id, node);
		}

		this.nodesById = nextNodesById;
		this.rootIds = snapshot.rootIds;

		this.onDidChangeTreeDataEmitter.fire();
	}

	public getTreeItem(element: Node): vscode.TreeItem {
		const treeItem = new vscode.TreeItem(
			element.name,
			element.children.length > 0
				? vscode.TreeItemCollapsibleState.Collapsed
				: vscode.TreeItemCollapsibleState.None
		);

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

	public getChildren(element?: Node): Node[] {
		let nodes: Node[];

		if (!element) {
			nodes = this.rootIds
				.map((rootId) => this.nodesById.get(rootId))
				.filter((node): node is Node => node !== undefined);
		} else {
			nodes = element.children
				.map((childId) => this.nodesById.get(childId))
				.filter((node): node is Node => node !== undefined);
		}

		return this.sorter.sortNodes(nodes) as Node[];
	}

	private getIconForClassName(className: string): vscode.Uri {
		return vscode.Uri.joinPath(
			this.extensionUri,
			"assets",
			`${className}@3x.png`
		);
	}

	private isScriptClass(className: string): boolean {
		return className === "Script" || className === "LocalScript" || className === "ModuleScript";
	}

}
