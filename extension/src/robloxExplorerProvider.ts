import * as vscode from "vscode";
import { VerdeBackend, Operation } from "./backend";
import { InstanceSorter, SortableNode } from "./instanceSorter";
import { DragAndDropController } from "./dragAndDropController";
import { isScriptClass } from "./utils";

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

	public getNodeByInstancePath(instancePath: string[]): Node | undefined {
		if (instancePath.length === 0) {
			return undefined;
		}

		let candidates: Node[] = this.rootIds
			.map((rootId) => this.nodesById.get(rootId))
			.filter((node): node is Node => node !== undefined);

		for (let i = 0; i < instancePath.length; i++) {
			const pathSegment = instancePath[i];
			let found: Node | undefined;

			for (const candidate of candidates) {
				if (candidate.name === pathSegment) {
					found = candidate;
					break;
				}
			}

			if (!found) {
				return undefined;
			}

			if (i === instancePath.length - 1) {
				return found;
			}

			candidates = found.children
				.map((childId) => this.nodesById.get(childId))
				.filter((node): node is Node => node !== undefined);
		}

		return undefined;
	}

	public async performOperation(operation: Operation) {
		if (!this.backend) {
			throw new Error("Backend not set");
		}
		return this.backend.sendOperation(operation);
	}

	public getDragAndDropController(): vscode.TreeDragAndDropController<Node> {
		return new DragAndDropController(this);
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

		if (isScriptClass(element.className)) {
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

	public getParent(element: Node): Node | undefined {
		if (!element.parentId) {
			return undefined;
		}
		return this.nodesById.get(element.parentId);
	}

	private getIconForClassName(className: string): vscode.Uri {
		return vscode.Uri.joinPath(
			this.extensionUri,
			"assets",
			`${className}.png`
		);
	}
}
