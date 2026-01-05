import * as vscode from "vscode";
import { RblxExplorerBackend } from "./backend";
import { Node } from "./robloxExplorerProvider";

export class PropertiesPanel {
    private panel: vscode.WebviewPanel | null = null;
    private backend: RblxExplorerBackend;
    private treeView: vscode.TreeView<Node>;
    private extensionUri: vscode.Uri;
    private currentNodeId: string | null = null;

    constructor(backend: RblxExplorerBackend, treeView: vscode.TreeView<Node>, extensionUri: vscode.Uri) {
        this.backend = backend;
        this.treeView = treeView;
        this.extensionUri = extensionUri;
    }

    public show(nodeId: string): void {
        this.currentNodeId = nodeId;

        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                "verde.properties",
                `Properties - ${nodeId}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
                }
            );

            this.panel.onDidDispose(
                () => {
                    this.panel = null;
                    this.currentNodeId = null;
                },
                null
            );

            this.panel.webview.onDidReceiveMessage(async (message) => {
                await this.handleMessage(message);
            });

            this.panel.webview.html = this.getHtmlContent();
        } else {
            this.panel.title = `Properties - ${nodeId}`;
        }

        this.panel.reveal();
        this.loadProperties();
    }

    public hide(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
            this.currentNodeId = null;
        }
    }

    private async loadProperties(): Promise<void> {
        if (!this.currentNodeId || !this.panel) {
            return;
        }

        try {
            const properties = await this.backend.getProperties(this.currentNodeId);
            this.panel.webview.postMessage({
                type: "updateProperties",
                properties,
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
        }
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Properties</title>
	<style>
		html, body {
			height: 100%;
			width: 100%;
			margin: 0;
			padding: 0;
			box-sizing: border-box;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			font-family: var(--vscode-font-family);
			font-size: 12px;
			overflow: hidden;
		}

		* { box-sizing: border-box; }

		.root {
			height: 100%;
			display: flex;
			flex-direction: column;
		}

		.topbar {
			flex: 0 0 auto;
			padding: 6px 6px 6px 6px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editor-background);
		}

		.filter {
			width: 100%;
			height: 22px;
			padding: 0 8px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			outline: none;
			border-radius: 2px;
			font-size: 12px;
		}

		.filter::placeholder {
			color: var(--vscode-descriptionForeground);
		}

		.filter:focus {
			border-color: var(--vscode-focusBorder);
			box-shadow: 0 0 0 1px var(--vscode-focusBorder);
		}

		.scroller {
			flex: 1 1 auto;
			overflow: auto;
		}

		.category {
			padding: 0;
			margin: 0;
		}

		.category-header {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 6px 4px 6px;
			font-weight: 600;
			color: var(--vscode-editor-foreground);
			user-select: none;
		}

		.category-header .caret {
			width: 0;
			height: 0;
			border-left: 5px solid var(--vscode-editor-foreground);
			border-top: 4px solid transparent;
			border-bottom: 4px solid transparent;
			opacity: 0.9;
			transform: rotate(90deg) translateY(0px);
		}

		.category.collapsed .category-header .caret {
			transform: rotate(0deg) translateY(0px);
		}

		.rows {
			border-top: 1px solid var(--vscode-panel-border);
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.category.collapsed .rows {
			display: none;
		}

		.property-row {
			display: grid;
			grid-template-columns: 1fr 1.2fr;
			align-items: center;
			height: 22px;
			padding: 0 6px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.property-row:last-child {
			border-bottom: none;
		}

		.property-row:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.property-name {
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
			padding-right: 8px;
			color: var(--vscode-editor-foreground);
		}

		.property-value {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			min-width: 0;
		}

		.value-input, .value-select {
			width: 100%;
			height: 18px;
			padding: 0 6px;
			border: 1px solid transparent;
			background: transparent;
			color: var(--vscode-editor-foreground);
			font-size: 12px;
			border-radius: 2px;
			outline: none;
			text-align: left;
		}

		.value-input:focus, .value-select:focus {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-input-background);
		}

		.value-select {
			appearance: none;
			-webkit-appearance: none;
			-moz-appearance: none;
			padding-right: 18px;
			border: 1px solid var(--vscode-input-border);
			background: var(--vscode-input-background);
			background-image:
				linear-gradient(45deg, transparent 50%, var(--vscode-editor-foreground) 50%),
				linear-gradient(135deg, var(--vscode-editor-foreground) 50%, transparent 50%);
			background-position:
				calc(100% - 10px) 7px,
				calc(100% - 6px) 7px;
			background-size:
				4px 4px,
				4px 4px;
			background-repeat: no-repeat;
		}

		.value-checkbox {
			width: 14px;
			height: 14px;
			margin: 0 2px 0 0;
		}

		.instance-link {
			display: inline-flex;
			align-items: center;
			min-width: 0;
			gap: 6px;
			width: 100%;
			justify-content: flex-start;
			padding: 0 2px;
		}

		.instance-link a {
			color: var(--vscode-textLink-foreground);
			text-decoration: none;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.instance-link a:hover {
			text-decoration: underline;
		}

		.none {
			color: var(--vscode-descriptionForeground);
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.empty {
			padding: 10px 6px;
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="root">
		<div class="topbar">
			<input id="filter" class="filter" type="text" placeholder="Filter Properties (Ctrl+Shift+P)" spellcheck="false" />
		</div>
		<div id="scroller" class="scroller">
			<div id="properties-container"></div>
		</div>
	</div>

	<script>
		const vscode = acquireVsCodeApi();

		let allProperties = [];
		let filterText = "";
		const collapsedCategories = new Set();

		const container = document.getElementById("properties-container");
		const filterInput = document.getElementById("filter");

		filterInput.addEventListener("input", () => {
			filterText = (filterInput.value || "").trim().toLowerCase();
			render();
		});

		filterInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				filterInput.value = "";
				filterText = "";
				render();
			}
		});

		function updateProperties(newProperties) {
			allProperties = Array.isArray(newProperties) ? newProperties : [];
			render();
		}

		function groupByCategory(properties) {
			const categories = new Map();
			for (const prop of properties) {
				const categoryName = (prop.category || "Other").toString();
				if (!categories.has(categoryName)) categories.set(categoryName, []);
				categories.get(categoryName).push(prop);
			}
			return categories;
		}

		function matchesFilter(prop) {
			if (!filterText) return true;
			const name = (prop.name || "").toString().toLowerCase();
			const category = (prop.category || "Other").toString().toLowerCase();
			const type = (prop.type || "").toString().toLowerCase();
			return name.includes(filterText) || category.includes(filterText) || type.includes(filterText);
		}

		function render() {
			container.innerHTML = "";

			const filtered = allProperties.filter(matchesFilter);
			if (filtered.length === 0) {
				const empty = document.createElement("div");
				empty.className = "empty";
				empty.textContent = allProperties.length ? "No matching properties." : "No properties available.";
				container.appendChild(empty);
				return;
			}

			const categories = groupByCategory(filtered);
			const sortedCategoryNames = Array.from(categories.keys()).sort((a, b) => a.localeCompare(b));

			for (const categoryName of sortedCategoryNames) {
				const categoryProps = categories.get(categoryName) || [];

				const categoryRoot = document.createElement("div");
				categoryRoot.className = "category" + (collapsedCategories.has(categoryName) ? " collapsed" : "");

				const header = document.createElement("div");
				header.className = "category-header";

				const caret = document.createElement("div");
				caret.className = "caret";
				header.appendChild(caret);

				const title = document.createElement("div");
				title.textContent = categoryName;
				header.appendChild(title);

				header.addEventListener("click", () => {
					if (collapsedCategories.has(categoryName)) collapsedCategories.delete(categoryName);
					else collapsedCategories.add(categoryName);
					render();
				});

				categoryRoot.appendChild(header);

				const rows = document.createElement("div");
				rows.className = "rows";

				for (const prop of categoryProps) {
					rows.appendChild(createRow(prop));
				}

				categoryRoot.appendChild(rows);
				container.appendChild(categoryRoot);
			}
		}

		function createRow(prop) {
			const row = document.createElement("div");
			row.className = "property-row";

			const name = document.createElement("div");
			name.className = "property-name";
			name.textContent = prop.name || "";
			row.appendChild(name);

			const value = document.createElement("div");
			value.className = "property-value";
			value.appendChild(createEditor(prop));
			row.appendChild(value);

			return row;
		}

		function postSetProperty(propertyName, propertyValue) {
			vscode.postMessage({
				type: "setProperty",
				propertyName,
				propertyValue,
			});
		}

		function createEditor(prop) {
			if (prop && prop.isInstanceReference) {
				const wrapper = document.createElement("div");
				wrapper.className = "instance-link";

				if (prop.referencedInstanceId && prop.referencedInstanceName) {
					const link = document.createElement("a");
					link.href = "#";
					link.textContent = prop.referencedInstanceName;
					link.addEventListener("click", (e) => {
						e.preventDefault();
						vscode.commands.executeCommand('verde.navigateToInstance', prop.referencedInstanceId);
					});
					wrapper.appendChild(link);
				} else {
					const none = document.createElement("div");
					none.className = "none";
					none.textContent = "None";
					wrapper.appendChild(none);
				}

				return wrapper;
			}

			if (prop && prop.isEnum && Array.isArray(prop.enumValues)) {
				const select = document.createElement("select");
				select.className = "value-select";

				for (const enumValue of prop.enumValues) {
					const option = document.createElement("option");
					option.value = String(enumValue.value);
					option.textContent = enumValue.name;
					if (prop.value && prop.value.Value === enumValue.value) option.selected = true;
					select.appendChild(option);
				}

				select.addEventListener("change", () => {
					const selectedOption = select.options[select.selectedIndex];
					postSetProperty(prop.name, { EnumName: selectedOption.textContent, EnumType: prop.type });
				});

				return select;
			}

			switch (prop.type) {
				case "bool": {
					const checkbox = document.createElement("input");
					checkbox.type = "checkbox";
					checkbox.className = "value-checkbox";
					checkbox.checked = !!prop.value;

					checkbox.addEventListener("change", () => {
						postSetProperty(prop.name, checkbox.checked);
					});

					return checkbox;
				}

				case "string": {
					const input = document.createElement("input");
					input.type = "text";
					input.className = "value-input";
					input.value = prop.value ?? "";

					input.addEventListener("change", () => {
						postSetProperty(prop.name, input.value);
					});

					return input;
				}

				case "number":
				case "int":
				case "float":
				case "double": {
					const input = document.createElement("input");
					input.type = "text";
					input.className = "value-input";
					input.value = prop.value ?? "0";

					input.addEventListener("change", () => {
						const raw = (input.value || "").trim();
						const numericValue = prop.type.includes("int") ? parseInt(raw, 10) : parseFloat(raw);
						if (!Number.isFinite(numericValue)) return;
						postSetProperty(prop.name, numericValue);
					});

					return input;
				}

				case "Vector3": {
					const input = document.createElement("input");
					input.type = "text";
					input.className = "value-input";

					if (prop.value && typeof prop.value === "object") {
						input.value = \`\${prop.value.X}, \${prop.value.Y}, \${prop.value.Z}\`;
					} else {
						input.value = "0, 0, 0";
					}

					input.addEventListener("change", () => {
						const parts = (input.value || "").split(",").map(s => parseFloat(s.trim()));
						if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return;
						postSetProperty(prop.name, { X: parts[0], Y: parts[1], Z: parts[2] });
					});

					return input;
				}

				case "UDim2": {
					const input = document.createElement("input");
					input.type = "text";
					input.className = "value-input";

					if (prop.value && prop.value.X && prop.value.Y) {
						input.value = \`\${prop.value.X.Scale}, \${prop.value.X.Offset}, \${prop.value.Y.Scale}, \${prop.value.Y.Offset}\`;
					} else {
						input.value = "0, 0, 0, 0";
					}

					input.addEventListener("change", () => {
						const parts = (input.value || "").split(",").map(s => parseFloat(s.trim()));
						if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return;
						postSetProperty(prop.name, {
							X: { Scale: parts[0], Offset: parts[1] },
							Y: { Scale: parts[2], Offset: parts[3] },
						});
					});

					return input;
				}

				case "Color3": {
					const input = document.createElement("input");
					input.type = "color";
					input.className = "value-input";
					input.style.padding = "0";
					input.style.height = "18px";

					if (prop.value && typeof prop.value === "object") {
						const r = Math.max(0, Math.min(255, Math.round((prop.value.R ?? 0) * 255)));
						const g = Math.max(0, Math.min(255, Math.round((prop.value.G ?? 0) * 255)));
						const b = Math.max(0, Math.min(255, Math.round((prop.value.B ?? 0) * 255)));
						input.value = \`#\${r.toString(16).padStart(2, "0")}\${g.toString(16).padStart(2, "0")}\${b.toString(16).padStart(2, "0")}\`;
					} else {
						input.value = "#000000";
					}

					input.addEventListener("change", () => {
						const r = parseInt(input.value.slice(1, 3), 16) / 255;
						const g = parseInt(input.value.slice(3, 5), 16) / 255;
						const b = parseInt(input.value.slice(5, 7), 16) / 255;
						postSetProperty(prop.name, { R: r, G: g, B: b });
					});

					return input;
				}

				default: {
					const input = document.createElement("input");
					input.type = "text";
					input.className = "value-input";
					input.value = prop.value != null ? String(prop.value) : "";

					input.addEventListener("change", () => {
						const raw = input.value;
						try {
							postSetProperty(prop.name, JSON.parse(raw));
						} catch {
							postSetProperty(prop.name, raw);
						}
					});

					return input;
				}
			}
		}

		window.addEventListener("message", (event) => {
			const message = event.data;
			if (message && message.type === "updateProperties") {
				updateProperties(message.properties);
			}
		});
	</script>
</body>
</html>`;
    }

    private async handleMessage(message: any): Promise<void> {
        if (message.type === "navigateToInstance") {
            vscode.commands.executeCommand("rblxexplorer.navigateToInstance", message.instanceId);
            return;
        }

        if (this.currentNodeId && message.type === "setProperty") {
            try {
                await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to update property: ${error}`);
            }
        }
    }

    public dispose(): void {
        this.hide();
    }
}
