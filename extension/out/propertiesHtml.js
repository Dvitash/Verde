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
exports.getPropertiesHtml = getPropertiesHtml;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function getPropertiesHtml(extensionUri, options = {}) {
    const { showToggleButton = false, showFilterInput = false } = options;
    const htmlPath = path.join(extensionUri.fsPath, "resources", "properties.html");
    const cssPath = path.join(extensionUri.fsPath, "resources", "properties.css");
    let cssContent = '';
    try {
        cssContent = fs.readFileSync(cssPath, 'utf8');
    }
    catch (cssError) {
        console.error("Failed to read properties.css:", cssError);
        cssContent = `body { background: red; color: white; }`;
    }
    try {
        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const styleTag = `<style>${cssContent}</style>`;
        htmlContent = htmlContent.replace('<link href="{{styleUri}}" rel="stylesheet">', styleTag);
        htmlContent = htmlContent.replace('{{topbarHtml}}', getTopbarHtml(options));
        htmlContent = htmlContent.replace('{{scriptElements}}', getScriptElements(options));
        htmlContent = htmlContent.replace('{{filterLogic}}', getFilterLogic(options));
        return htmlContent;
    }
    catch (error) {
        console.error("Failed to read properties.html:", error);
        return `<!DOCTYPE html>
<html>
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Properties</title>
	<style>${cssContent}</style>
</head>
<body>
	<div class="root">
		${getTopbarHtml(options)}
		<div id="scroller" class="scroller">
			<div id="properties-container">Failed to load properties interface</div>
		</div>
	</div>
</body>
</html>`;
    }
}
function getTopbarHtml(options) {
    const { showToggleButton = false, showFilterInput = false } = options;
    if (!showToggleButton && !showFilterInput) {
        return '';
    }
    let topbarContent = '';
    if (showToggleButton) {
        topbarContent += '<button id="toggle-mode" class="toggle-button" title="Toggle Panel Mode">⇄</button>';
    }
    topbarContent += '<span id="properties-title" class="properties-title">Properties</span>';
    if (showFilterInput) {
        topbarContent += '<input id="filter" class="filter" type="text" placeholder="Filter Properties (Ctrl+Shift+P)" spellcheck="false" />';
    }
    return `<div class="topbar">${topbarContent}</div>`;
}
function getScriptElements(options) {
    const { showToggleButton = false, showFilterInput = false } = options;
    let scriptElements = '';
    if (showToggleButton) {
        scriptElements += `
		const toggleButton = document.getElementById("toggle-mode");
		toggleButton.addEventListener("click", () => {
			vscode.postMessage({
				type: "togglePanelMode"
			});
		});`;
    }
    if (showFilterInput) {
        scriptElements += `
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
		});`;
    }
    return scriptElements;
}
function getFilterLogic(options) {
    const { showFilterInput = false } = options;
    if (showFilterInput) {
        return `
		let filterText = "";
		if (!filterText) return true;
		const name = (prop.name || "").toString().toLowerCase();
		const category = (prop.category || "Other").toString().toLowerCase();
		const type = (prop.type || "").toString().toLowerCase();
		return name.includes(filterText) || category.includes(filterText) || type.includes(filterText);`;
    }
    else {
        return `return true;`;
    }
}
//# sourceMappingURL=propertiesHtml.js.map