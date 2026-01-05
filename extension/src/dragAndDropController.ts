import * as vscode from "vscode";
import { Node } from "./robloxExplorerProvider";
import { RobloxExplorerProvider } from "./robloxExplorerProvider";

export class DragAndDropController implements vscode.TreeDragAndDropController<Node> {
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

