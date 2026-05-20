// if syncToFilesystem is enabled, try to do that instead before falling back to verde->studio sync

import * as vscode from "vscode";
import { RobloxExplorerProvider, Node } from "./robloxExplorerProvider";
import { VerdeBackend } from "./backend";
import { getClassNames } from "./robloxClasses";
import { isScriptClass, scriptIconClass } from "./utils";
import { getThemeCssBlock, getThemeScriptBlock, getThemeStyleAttribute } from "./webviewTheme";
import { SourcemapParser } from "./sourcemapParser";
import { isSyncableClass, createOnFilesystem, moveOnFilesystem } from "./filesystemSync";

type WebviewNode = {
  id: string;
  name: string;
  className: string;
  iconClassName: string;
  children: string[];
  isScript: boolean;
  disabled?: boolean;
};

export class ExplorerViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "verde.view";

  private webviewView: vscode.WebviewView | undefined;
  private selectedIds: string[] = [];
  private selectionListeners: ((nodes: Node[]) => void)[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly explorerProvider: RobloxExplorerProvider,
    private readonly backend: VerdeBackend,
    private readonly sourcemapParser: SourcemapParser,
  ) {
    this.explorerProvider.onChange(() => this.pushTree());
  }

  public onSelectionChanged(listener: (nodes: Node[]) => void): void {
    this.selectionListeners.push(listener);
  }

  public getSelection(): Node[] {
    return this.selectedIds
      .map(id => this.explorerProvider.getNodeById(id))
      .filter((n): n is Node => n !== undefined);
  }

  public isVisible(): boolean {
    return this.webviewView?.visible ?? false;
  }

  public startRename(nodeId: string): void {
    this.post({ type: "startRename", nodeId });
  }

  public postClassNames(): void {
    this.post({ type: "updateClasses", classes: getClassNames() });
  }

  public collapseAll(): void {
    this.post({ type: "collapseAll" });
  }

  public reveal(node: Node): void {
    const ancestors: string[] = [];
    let cur: Node | undefined = node;
    while (cur?.parentId) {
      ancestors.push(cur.parentId);
      cur = this.explorerProvider.getNodeById(cur.parentId);
    }
    this.selectedIds = [node.id];
    this.post({
      type: "revealNode",
      nodeId: node.id,
      ancestors,
      selectedIds: [node.id],
    });
    this.fireSelectionChanged();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "assets"),
        vscode.Uri.joinPath(this.extensionUri, "resources"),
      ],
    };
    webviewView.webview.onDidReceiveMessage(m => this.onMessage(m));
    webviewView.onDidDispose(() => { this.webviewView = undefined; });
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("verde.coloredSelection") || e.affectsConfiguration("verde.coloredSelectionColor")) {
        this.pushSelectionColor();
      }
    });
    const assetBase = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "assets")
    ).toString();
    webviewView.webview.html = this.buildHtml(webviewView.webview, assetBase);
    this.pushTree();
    this.pushSelectionColor();
  }

  public refreshWebviewHtml(): void {
    if (!this.webviewView) return;
    const assetBase = this.webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "assets")
    ).toString();
    this.webviewView.webview.html = this.buildHtml(this.webviewView.webview, assetBase);
    this.pushTree();
  }

  private post(msg: unknown): void {
    this.webviewView?.webview.postMessage(msg);
  }

  private pushSelectionColor(): void {
    const cfg = vscode.workspace.getConfiguration("verde");
    this.post({
      type: "updateSelectionColor",
      enabled: cfg.get<boolean>("coloredSelection", false),
      color: cfg.get<string>("coloredSelectionColor", "#264f78"),
    });
  }

  private pushTree(): void {
    if (!this.webviewView) return;
    const all = this.explorerProvider.getAllNodes();
    const nodes: Record<string, WebviewNode> = {};
    for (const n of all) {
      const sorted = this.explorerProvider.getSortedChildren(n.id);
      const isScript = isScriptClass(n.className);
      const w: WebviewNode = {
        id: n.id,
        name: n.name,
        className: n.className,
        iconClassName: scriptIconClass(n.className, n.runContext),
        children: sorted.map(c => c.id),
        isScript,
      };
      if (isScript) {
        w.disabled = !!n.disabled;
      }
      nodes[n.id] = w;
    }
    const roots = this.explorerProvider.getSortedChildren(null);
    this.post({
      type: "updateTree",
      nodes,
      rootIds: roots.map(c => c.id),
      selectedIds: this.selectedIds,
    });
  }

  private fireSelectionChanged(): void {
    const nodes = this.getSelection();
    for (const cb of this.selectionListeners) cb(nodes);
  }

  private onMessage(msg: any): void {
    switch (msg.type) {
      case "selectionChanged":
        this.selectedIds = msg.nodeIds ?? [];
        this.fireSelectionChanged();
        break;
      case "createInstance":
        this.doCreateInstance(msg.parentId, msg.className);
        break;
      case "renameInstance": {
        const node = msg.nodeId ? this.explorerProvider.getNodeById(msg.nodeId) : undefined;
        if (node && typeof msg.newName === "string") {
          vscode.commands.executeCommand("verde.renameInstance", node, msg.newName);
        }
        break;
      }
      case "runCommand": {
        const node = msg.nodeId ? this.explorerProvider.getNodeById(msg.nodeId) : undefined;
        if (node) {
          vscode.commands.executeCommand(msg.command, node);
        } else {
          vscode.commands.executeCommand(msg.command);
        }
        break;
      }
      case "scriptActivated": {
        const node = this.explorerProvider.getNodeById(msg.nodeId);
        if (node) vscode.commands.executeCommand("verde.openScript", node);
        break;
      }
      case "reparentNode": {
        const nodeId = msg.nodeId as string | undefined;
        const newParentId = msg.newParentId as string | undefined;
        if (nodeId == null) break;

        const fsSync = vscode.workspace.getConfiguration('verde').get<boolean>('syncToFilesystem', false);
        if (fsSync && newParentId) {
          const node = this.explorerProvider.getNodeById(nodeId);
          const newParent = this.explorerProvider.getNodeById(newParentId);
          if (node && newParent && isSyncableClass(node.className)) {
            (async () => {
              await this.sourcemapParser.loadSourcemaps();
              const nodePath = this.getInstancePath(node);
              const newParentPath = this.getInstancePath(newParent);
              const moved = await moveOnFilesystem(this.sourcemapParser, nodePath, node.className, newParentPath);
              if (moved) return;
              const result = await this.backend.sendOperation({
                type: "move_node",
                nodeId,
                newParentId: newParentId ?? null,
              });
              if (!result.success) {
                vscode.window.showErrorMessage(result.error ?? "Failed to move instance.");
              }
            })().catch((err) => vscode.window.showErrorMessage(String(err)));
            break;
          }
        }

        this.backend.sendOperation({
          type: "move_node",
          nodeId,
          newParentId: newParentId ?? null,
        }).then((result) => {
          if (!result.success) {
            vscode.window.showErrorMessage(result.error ?? "Failed to move instance.");
          }
        }).catch((err) => {
          vscode.window.showErrorMessage(String(err));
        });
        break;
      }
    }
  }

  private async waitForNode(nodeId: string, timeoutMs: number = 3000): Promise<Node | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const node = this.explorerProvider.getNodeById(nodeId);
      if (node) return node;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  private getInstancePath(node: Node): string[] {
    const path: string[] = [node.name];
    let current = node;
    while (current.parentId) {
      const parent = this.explorerProvider.getNodeById(current.parentId);
      if (!parent) break;
      path.unshift(parent.name);
      current = parent;
    }
    return path;
  }

  private async doCreateInstance(parentId: string, className: string): Promise<void> {
    const fsSync = vscode.workspace.getConfiguration('verde').get<boolean>('syncToFilesystem', false);
    if (fsSync && isSyncableClass(className)) {
      const parentNode = this.explorerProvider.getNodeById(parentId);
      if (parentNode) {
        await this.sourcemapParser.loadSourcemaps();
        const parentPath = this.getInstancePath(parentNode);
        const fsResult = await createOnFilesystem(this.sourcemapParser, parentPath, className);
        if (fsResult.created) {
          if (fsResult.fileUri && isScriptClass(className)) {
            try {
              const document = await vscode.workspace.openTextDocument(fsResult.fileUri);
              await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            } catch (error) {
              console.debug('Failed to open created script:', error);
            }
          }
          return;
        }
      }
    }

    try {
      const result = await this.backend.sendOperation({
        type: "create_instance",
        parentId,
        className,
      });
      if (!result.success) {
        vscode.window.showErrorMessage(`Failed to create instance: ${result.error}`);
        return;
      }
      if (result.data && typeof result.data === "string") {
        const newNode = await this.waitForNode(result.data);
        if (newNode) {
          this.reveal(newNode);
          this.post({ type: "focusTree" });
          if (isScriptClass(newNode.className)) {
            vscode.commands.executeCommand("verde.openScript", newNode);
          }
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create instance: ${String(e)}`);
    }
  }

  private buildHtml(webview: vscode.Webview, assetBase: string): string {
    const csp = webview.cspSource;
    const themeStyle = getThemeStyleAttribute();
    const themeCss = getThemeCssBlock();
    const themeScript = getThemeScriptBlock();
    return `<!DOCTYPE html>
<html lang="en" style="${themeStyle}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${csp}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${themeCss}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden;font-family:var(--vscode-font-family,sans-serif);font-size:var(--vscode-font-size,13px);color:var(--vscode-sideBar-foreground);background:var(--vscode-sideBar-background)}
body{display:flex;flex-direction:column}

#search-bar{padding:4px 4px;flex-shrink:0;background:var(--vscode-sideBar-background)}
#search{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:2px;padding:3px 4px;outline:none;font:inherit}
#search:focus{border-color:var(--vscode-focusBorder)}

#tree{flex:1;overflow-y:auto;overflow-x:hidden;outline:none;padding:0;background:var(--vscode-sideBar-background)}
.tree-row{display:flex;align-items:center;height:22px;cursor:pointer;padding-right:0;white-space:nowrap;user-select:none}
.tree-row:hover{background:var(--vscode-list-hoverBackground)}
.tree-row.selected{background:var(--vscode-list-inactiveSelectionBackground);color:var(--vscode-list-inactiveSelectionForeground)}
#tree:focus-within .tree-row.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.tree-row.dragging{opacity:0.5}
.tree-row.drag-over{background:var(--vscode-list-dropBackground);outline:1px solid var(--vscode-focusBorder)}

.tree-arrow{width:16px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;opacity:.7}
.tree-arrow:hover{opacity:1}
.tree-arrow::before{content:'\\25B6';display:inline-block;transition:transform .1s}
.tree-arrow.expanded::before{transform:rotate(90deg)}
.tree-arrow.leaf{visibility:hidden;pointer-events:none}

.tree-icon{width:16px;height:16px;flex-shrink:0;margin-right:4px;image-rendering:pixelated}
.tree-row.script-disabled .tree-icon{opacity:.45!important}
.tree-row.script-disabled .tree-name{color:var(--vscode-disabledForeground,var(--vscode-descriptionForeground))!important;opacity:.65!important}
.tree-row.tree-indent-guides{background-repeat:no-repeat}
.tree-name-group{flex:1;min-width:0;display:flex;align-items:center;gap:6px}
.tree-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tree-rename-input{flex:1;min-width:60px;height:18px;margin:0;padding:0 4px;border:1px solid var(--vscode-focusBorder);border-radius:2px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;outline:none}
.tree-rename-input:focus{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}

.tree-add-btn{display:none;width:16px;height:16px;border-radius:50%;border:none;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);font-size:14px;line-height:16px;text-align:center;cursor:pointer;flex-shrink:0;padding:0;align-items:center;justify-content:center}
.tree-row:hover .tree-add-btn{display:inline-flex}
.tree-add-btn:hover{background:var(--vscode-button-secondaryHoverBackground)}

#ctx-menu{position:fixed;z-index:1000;background:var(--vscode-menu-background);border:1px solid var(--vscode-menu-border);min-width:160px;padding:4px 0;border-radius:4px}
#ctx-menu.hidden{display:none}
.ctx-item{padding:4px 20px 4px 10px;cursor:pointer;white-space:nowrap;color:var(--vscode-menu-foreground)}
.ctx-item:hover{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground)}
.ctx-sep{height:1px;margin:4px 0;background:var(--vscode-menu-separatorBackground)}

#quick-add{position:fixed;top:0;left:0;z-index:2000;pointer-events:none}
#quick-add.hidden{display:none}
#qa-panel{pointer-events:auto;position:fixed;width:280px;max-height:320px;background:var(--vscode-sideBar-background);border:1px solid var(--vscode-widget-border);display:flex;flex-direction:column;border-radius:4px;overflow:hidden}
#qa-search{width:100%;border:none;border-bottom:1px solid var(--vscode-widget-border);background:var(--vscode-sideBar-background);color:var(--vscode-sideBar-foreground);padding:8px 10px;outline:none;font:inherit}
#qa-search::placeholder{color:var(--vscode-input-placeholderForeground)}
#qa-search:focus{border-bottom-color:var(--vscode-focusBorder)}
#qa-list-wrap{overflow-y:auto;flex:1;min-height:0}
.qa-section{font-size:11px;font-weight:600;color:var(--vscode-sideBar-foreground);padding:6px 10px 4px;text-transform:uppercase;letter-spacing:0.5px}
.qa-item{display:flex;align-items:center;padding:5px 10px;cursor:pointer;height:28px;color:var(--vscode-sideBar-foreground)}
.qa-item.selected{background:var(--vscode-list-activeSelectionBackground);color:var(--vscode-list-activeSelectionForeground)}
.qa-item:not(.selected):hover{background:var(--vscode-list-hoverBackground)}
.qa-icon{width:16px;height:16px;margin-right:8px;image-rendering:pixelated;flex-shrink:0}
</style>
<style id="sel-override"></style>
${themeScript}
</head>
<body>
<div id="search-bar"><input id="search" type="text" placeholder="Search explorer..." spellcheck="false" /></div>
<div id="tree" tabindex="0"></div>
<div id="quick-add" class="hidden">
  <div id="qa-panel">
    <input id="qa-search" type="text" placeholder="Search object" spellcheck="false" autocomplete="off" />
    <div id="qa-list-wrap">
      <div id="qa-list"></div>
    </div>
  </div>
</div>
<div id="ctx-menu" class="hidden"></div>
<script>
(function(){
var ASSET=${JSON.stringify(assetBase)};
var CLASSES=${JSON.stringify(getClassNames())};
var vscode=acquireVsCodeApi();

var nodes={},rootIds=[],selectedIds=[];
var searchFilter='';
var qaParentId=null,qaFiltered=CLASSES,qaIdx=0,qaOutsideClick=null;
var ctxNodeId=null;
var renameNodeId=null;
var SLOW_CLICK_RENAME_DELAY=800;
var DBLCLICK_THRESHOLD=400;
var slowClickTimer=null;
var lastClickTime=0,lastClickId=null;

var expandedIds=new Set();
var searchExpandedIds=new Set();
var savedExpandedIds=null;
var dragSourceId=null;
var saved=vscode.getState();
if(saved&&Array.isArray(saved.exp))expandedIds=new Set(saved.exp);
function activeExp(){return searchFilter?searchExpandedIds:expandedIds}
function saveExp(){if(!searchFilter)vscode.setState({exp:[...expandedIds]})}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

var treeEl=document.getElementById('tree');
var searchEl=document.getElementById('search');
var ctxEl=document.getElementById('ctx-menu');
var qaEl=document.getElementById('quick-add');
var qaPanel=document.getElementById('qa-panel');
var qaSearchEl=document.getElementById('qa-search');
var qaListEl=document.getElementById('qa-list');

document.addEventListener('error',function(e){if(e.target&&e.target.tagName==='IMG')e.target.style.visibility='hidden'},true);

/* ---- messages from extension ---- */
window.addEventListener('message',function(e){
  var m=e.data;
  switch(m.type){
    case 'updateTree':
      nodes=m.nodes||{};rootIds=m.rootIds||[];
      selectedIds=m.selectedIds||selectedIds;
      for(var k in nodes){var nn=nodes[k];nn._nl=nn.name.toLowerCase();nn._cl=nn.className.toLowerCase()}
      renderTree();break;
    case 'updateSelection':
      selectedIds=m.selectedIds||[];updateSelVis();break;
    case 'revealNode':
      if(Array.isArray(m.ancestors))m.ancestors.forEach(function(id){expandedIds.add(id)});
      selectedIds=m.selectedIds||[];
      saveExp();renderTree();
      requestAnimationFrame(function(){scrollTo(m.nodeId);treeEl.focus()});break;
    case 'focusTree':
      treeEl.focus();break;
    case 'scrollToNode':
      requestAnimationFrame(function(){scrollTo(m.nodeId)});break;
    case 'expandNodes':
      if(Array.isArray(m.nodeIds))m.nodeIds.forEach(function(id){expandedIds.add(id)});
      saveExp();renderTree();break;
    case 'startRename':
      renameNodeId=m.nodeId||null;
      renderTree();
      afterRenameInputMount();break;
    case 'updateClasses':
      if(Array.isArray(m.classes)&&m.classes.length){
        CLASSES=m.classes;
        if(!qaEl.classList.contains('hidden')){
          var qq=qaSearchEl.value.trim().toLowerCase();
          qaFiltered=qq?CLASSES.filter(function(c){return c.toLowerCase().indexOf(qq)>=0}):CLASSES;
          qaIdx=0;renderQA();
        }
      }
      break;
    case 'updateSelectionColor':
      var so=document.getElementById('sel-override');
      if(so){
        if(m.enabled&&m.color){
          so.textContent='.tree-row.selected{background:'+m.color+' !important}#tree:focus-within .tree-row.selected{background:'+m.color+' !important}';
        }else{so.textContent=''}
      }
      break;
    case 'collapseAll':
      expandedIds.clear();
      searchExpandedIds.clear();
      savedExpandedIds=null;
      for(var i=0;i<selectedIds.length;i++)expandAncestors(selectedIds[i]);
      saveExp();renderTree();
      if(selectedIds.length>0)requestAnimationFrame(function(){scrollTo(selectedIds[0])});
      break;
  }
});

/* ---- search ---- */
var searchDebounce=null;
function expandSearchMatches(){
  visCache={};
  searchExpandedIds=new Set(expandedIds);
  function walk(id){
    var n=nodes[id];if(!n)return;
    if(!isVis(id))return;
    if(n.children.length>0)searchExpandedIds.add(id);
    for(var i=0;i<n.children.length;i++)walk(n.children[i]);
  }
  for(var i=0;i<rootIds.length;i++)walk(rootIds[i]);
}
function expandAncestors(id){
  var n=nodes[id];if(!n)return;
  for(var k in nodes){
    var p=nodes[k];
    if(p.children.indexOf(id)>=0){expandedIds.add(k);expandAncestors(k);return}
  }
}
searchEl.addEventListener('input',function(){
  var raw=searchEl.value.trim().toLowerCase();
  if(searchDebounce)clearTimeout(searchDebounce);
  if(!raw){
    if(savedExpandedIds){expandedIds=savedExpandedIds;savedExpandedIds=null}
    for(var i=0;i<selectedIds.length;i++)expandAncestors(selectedIds[i]);
    saveExp();
    searchFilter='';renderTree();return;
  }
  if(!savedExpandedIds)savedExpandedIds=new Set(expandedIds);
  searchDebounce=setTimeout(function(){searchFilter=raw;expandSearchMatches();renderTree()},50);
});
searchEl.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(savedExpandedIds){expandedIds=savedExpandedIds;savedExpandedIds=null}
    for(var i=0;i<selectedIds.length;i++)expandAncestors(selectedIds[i]);
    saveExp();
    searchEl.value='';searchFilter='';renderTree();treeEl.focus();e.preventDefault();
  }
});

var visCache={};
function isVis(id){
  if(id in visCache)return visCache[id];
  var n=nodes[id];
  if(!n)return(visCache[id]=false);
  if(n._nl.indexOf(searchFilter)>=0||n._cl.indexOf(searchFilter)>=0)return(visCache[id]=true);
  for(var i=0;i<n.children.length;i++){if(isVis(n.children[i]))return(visCache[id]=true)}
  return(visCache[id]=false);
}

function cancelRename(){
  renameNodeId=null;
  renderTree();
}
function submitRename(inp){
  var row=inp.closest('.tree-row');
  if(!row)return;
  var id=row.dataset.id;
  var val=inp.value.trim();
  if(!val)cancelRename();
  else{
    vscode.postMessage({type:'renameInstance',nodeId:id,newName:val});
    cancelRename();
  }
}
function afterRenameInputMount(){
  if(!renameNodeId)return;
  var inp=treeEl.querySelector('.tree-rename-input');
  if(!inp)return;
  inp.focus();
  inp.select();
  inp.addEventListener('keydown',function(ev){
    if(ev.key==='Enter'){submitRename(inp);ev.preventDefault();ev.stopPropagation()}
    else if(ev.key==='Escape'){cancelRename();ev.preventDefault();ev.stopPropagation()}
  });
  inp.addEventListener('blur',function(){setTimeout(function(){if(renameNodeId)cancelRename()},0)});
  inp.addEventListener('click',function(ev){ev.stopPropagation()});
}

/* ---- tree rendering (virtual scroll) ---- */
var ROW_HEIGHT=22;
var OVERSCAN=10;
var flatRows=[];
var vLastStart=-1,vLastEnd=-1;
var scrollRaf=false;

function buildFlatRows(){
  visCache={};
  flatRows=[];
  function walk(id,depth){
    if(searchFilter&&!isVis(id))return;
    var n=nodes[id];if(!n)return;
    var has=n.children.length>0;
    var exp=activeExp().has(id);
    flatRows.push({id:id,depth:depth});
    if(exp)for(var i=0;i<n.children.length;i++)walk(n.children[i],depth+1);
  }
  for(var i=0;i<rootIds.length;i++)walk(rootIds[i],0);
}

function renderTree(){
  buildFlatRows();
  vLastStart=-1;vLastEnd=-1;
  renderViewport();
  if(renameNodeId)afterRenameInputMount();
}

var INDENT=12;
var LINE_COLOR='var(--vscode-tree-indentGuidesStroke)';

function renderViewport(){
  var scrollTop=treeEl.scrollTop;
  var viewH=treeEl.clientHeight||400;
  var start=Math.max(0,Math.floor(scrollTop/ROW_HEIGHT)-OVERSCAN);
  var end=Math.min(flatRows.length,Math.ceil((scrollTop+viewH)/ROW_HEIGHT)+OVERSCAN);
  if(start===vLastStart&&end===vLastEnd)return;
  vLastStart=start;vLastEnd=end;
  var topPad=start*ROW_HEIGHT;
  var bottomPad=Math.max(0,(flatRows.length-end)*ROW_HEIGHT);
  var h=['<div style="padding-top:'+topPad+'px;padding-bottom:'+bottomPad+'px">'];
  for(var i=start;i<end;i++){
    var r=flatRows[i];
    buildRowHtml(r.id,r.depth,h);
  }
  h.push('</div>');
  treeEl.innerHTML=h.join('');
  if(renameNodeId)afterRenameInputMount();
}

function buildRowHtml(id,depth,h){
  var n=nodes[id];if(!n)return;
  var has=n.children.length>0;
  var exp=activeExp().has(id);
  var sel=selectedIds.indexOf(id)>=0;
  var pad=depth*INDENT;
  var ac=has?(exp?' expanded':''):' leaf';
  var disabled=n.isScript&&n.disabled===true;
  var rowClass='tree-row'+(sel?' selected':'')+(depth>0?' tree-indent-guides':'')+(disabled?' script-disabled':'');
  var style='padding-left:'+pad+'px';
  if(depth>0){
    var bgs=[],pos=[],sz=[];
    for(var i=0;i<depth;i++){
      bgs.push('linear-gradient(to right, '+LINE_COLOR+' 0, '+LINE_COLOR+' 1px, transparent 1px)');
      pos.push(((i+0.5)*INDENT)+'px 0');
      sz.push(INDENT+'px 100%');
    }
    style+=';background-image:'+bgs.join(',')+';background-position:'+pos.join(',')+';background-size:'+sz.join(',')+';background-repeat:no-repeat';
  }
  h.push('<div class="'+rowClass+'" data-id="'+id+'" data-s="'+(n.isScript?1:0)+'" data-disabled="'+(disabled?1:0)+'" draggable="'+(depth>0?'true':'false')+'" style="'+style+'">');
  h.push('<span class="tree-arrow'+ac+'"></span>');
  h.push('<img class="tree-icon" src="'+ASSET+'/'+esc(n.iconClassName||n.className)+'.png"'+(disabled?' style="opacity:.45"':'')+'>');
  h.push('<span class="tree-name-group">');
  if(id===renameNodeId){
    h.push('<input class="tree-rename-input" type="text" value="'+esc(n.name)+'" data-id="'+id+'">');
  }else{
    h.push('<span class="tree-name"'+(disabled?' style="color:var(--vscode-disabledForeground,var(--vscode-descriptionForeground));opacity:.65"':'')+'>'+esc(n.name)+'</span>');
  }
  h.push('<button class="tree-add-btn">+</button>');
  h.push('</span></div>');
}

treeEl.addEventListener('scroll',function(){
  if(scrollRaf)return;
  scrollRaf=true;
  requestAnimationFrame(function(){scrollRaf=false;renderViewport()});
});

/* ---- selection ---- */
function updateSelVis(){
  treeEl.querySelectorAll('.tree-row').forEach(function(r){r.classList.toggle('selected',selectedIds.indexOf(r.dataset.id)>=0)});
}
function scrollTo(id){
  for(var i=0;i<flatRows.length;i++){
    if(flatRows[i].id===id){
      var targetTop=i*ROW_HEIGHT;
      var viewH=treeEl.clientHeight||400;
      var scrollTop=treeEl.scrollTop;
      if(targetTop<scrollTop||targetTop+ROW_HEIGHT>scrollTop+viewH){
        treeEl.scrollTop=targetTop-Math.floor(viewH/2)+ROW_HEIGHT;
      }
      vLastStart=-1;vLastEnd=-1;
      renderViewport();
      return;
    }
  }
}

/* ---- tree events ---- */
treeEl.addEventListener('click',function(e){
  treeEl.focus();
  if(slowClickTimer){clearTimeout(slowClickTimer);slowClickTimer=null}
  var row=e.target.closest('.tree-row');
  if(!row){lastClickId=null;selectedIds=[];updateSelVis();vscode.postMessage({type:'selectionChanged',nodeIds:[]});return}
  var id=row.dataset.id;
  var arrow=e.target.closest('.tree-arrow');
  if(arrow&&!arrow.classList.contains('leaf')){
    lastClickId=null;
    var ae=activeExp();if(ae.has(id))ae.delete(id);else ae.add(id);
    saveExp();renderTree();return;
  }
  if(e.target.closest('.tree-add-btn')){lastClickId=null;openQA(id,row);return}
  var now=Date.now();
  var isDbl=id===lastClickId&&now-lastClickTime<DBLCLICK_THRESHOLD&&!e.ctrlKey&&!e.metaKey;
  lastClickTime=now;
  lastClickId=id;
  if(isDbl){
    lastClickId=null;
    if(row.dataset.s==='1'){vscode.postMessage({type:'scriptActivated',nodeId:id});return}
    var node=nodes[id];
    if(node&&node.children.length>0){
      var ae=activeExp();if(ae.has(id))ae.delete(id);else ae.add(id);
      saveExp();renderTree();
    }
    return;
  }
  if(e.ctrlKey||e.metaKey){var i=selectedIds.indexOf(id);if(i>=0)selectedIds.splice(i,1);else selectedIds.push(id)}
  else{
    var wasOnlySel=selectedIds.length===1&&selectedIds[0]===id;
    selectedIds=[id];
    if(wasOnlySel&&!renameNodeId){
      slowClickTimer=setTimeout(function(){slowClickTimer=null;renameNodeId=id;renderTree();afterRenameInputMount()},SLOW_CLICK_RENAME_DELAY);
    }
  }
  updateSelVis();
  vscode.postMessage({type:'selectionChanged',nodeIds:selectedIds.slice()});
});

treeEl.addEventListener('dblclick',function(e){e.preventDefault()});

treeEl.addEventListener('contextmenu',function(e){
  if(slowClickTimer){clearTimeout(slowClickTimer);slowClickTimer=null}
  lastClickId=null;
  e.preventDefault();
  var row=e.target.closest('.tree-row');if(!row)return;
  var id=row.dataset.id;
  if(selectedIds.indexOf(id)<0){selectedIds=[id];updateSelVis();vscode.postMessage({type:'selectionChanged',nodeIds:[id]})}
  showCtx(e.clientX,e.clientY,id,row.dataset.s==='1');
});

/* ---- drag and drop ---- */
function clearDragOver(){treeEl.querySelectorAll('.tree-row').forEach(function(r){r.classList.remove('drag-over')})}
treeEl.addEventListener('dragstart',function(e){
  if(slowClickTimer){clearTimeout(slowClickTimer);slowClickTimer=null}
  lastClickId=null;
  if(e.target.closest('.tree-arrow,.tree-add-btn,.tree-rename-input')){e.preventDefault();return}
  var row=e.target.closest('.tree-row');if(!row)return;
  dragSourceId=row.dataset.id;
  e.dataTransfer.setData('text/plain',dragSourceId);
  e.dataTransfer.effectAllowed='move';
  row.classList.add('dragging');
});
treeEl.addEventListener('dragend',function(e){
  dragSourceId=null;
  treeEl.querySelectorAll('.tree-row').forEach(function(r){r.classList.remove('dragging')});
  clearDragOver();
});
treeEl.addEventListener('dragover',function(e){
  e.preventDefault();
  var row=e.target.closest('.tree-row');if(!row)return;
  var targetId=row.dataset.id;
  if(!dragSourceId||dragSourceId===targetId){e.dataTransfer.dropEffect='none';clearDragOver();return}
  e.dataTransfer.dropEffect='move';
  clearDragOver();
  row.classList.add('drag-over');
});
treeEl.addEventListener('dragleave',function(e){
  var row=e.target.closest('.tree-row');
  if(row&&!row.contains(e.relatedTarget))row.classList.remove('drag-over');
});
treeEl.addEventListener('drop',function(e){
  e.preventDefault();
  clearDragOver();
  var row=e.target.closest('.tree-row');if(!row)return;
  var targetId=row.dataset.id;
  var sourceId=dragSourceId||e.dataTransfer.getData('text/plain');
  if(!sourceId||sourceId===targetId)return;
  vscode.postMessage({type:'reparentNode',nodeId:sourceId,newParentId:targetId});
});

/* ---- context menu ---- */
function showCtx(x,y,id,isScript){
  ctxNodeId=id;
  var items=[
    {l:'Rename',c:'verde.renameInstance'},
    {l:'Duplicate',c:'verde.duplicateInstance'},
    {l:'Delete',c:'verde.deleteInstance'},
    {l:'Add Child...',c:'verde.addInstance'},
    null,
    {l:'Copy',c:'verde.copyInstance'},
    {l:'Paste',c:'verde.pasteInstance'},
    null,
    {l:'Copy Roblox Path',c:'verde.copyRobloxPath'}
  ];
  if(isScript){items.push({l:'Copy File Path',c:'verde.copyFilePath'});items.push(null);items.push({l:'Open Script',c:'verde.openScript'})}
  var html='';
  for(var i=0;i<items.length;i++){
    var it=items[i];
    if(!it){html+='<div class="ctx-sep"></div>';continue}
    html+='<div class="ctx-item" data-cmd="'+it.c+'">'+esc(it.l)+'</div>';
  }
  ctxEl.innerHTML=html;
  ctxEl.style.left=x+'px';ctxEl.style.top=y+'px';
  ctxEl.classList.remove('hidden');
  requestAnimationFrame(function(){
    var r=ctxEl.getBoundingClientRect();
    if(r.right>window.innerWidth)ctxEl.style.left=Math.max(0,window.innerWidth-r.width-2)+'px';
    if(r.bottom>window.innerHeight)ctxEl.style.top=Math.max(0,window.innerHeight-r.height-2)+'px';
  });
}
function hideCtx(){ctxEl.classList.add('hidden');ctxNodeId=null}

ctxEl.addEventListener('click',function(e){
  var item=e.target.closest('.ctx-item');if(!item||!ctxNodeId)return;
  var nid=ctxNodeId;var cmd=item.dataset.cmd;hideCtx();
  if(cmd==='verde.renameInstance'){renameNodeId=nid;renderTree();afterRenameInputMount()}
  else vscode.postMessage({type:'runCommand',command:cmd,nodeId:nid});
});
document.addEventListener('click',function(e){if(!e.target.closest('#ctx-menu'))hideCtx()});

/* ---- quick-add ---- */
function openQA(parentId,rowEl){
  qaParentId=parentId;qaFiltered=CLASSES;qaIdx=0;qaSearchEl.value='';
  renderQA();qaEl.classList.remove('hidden');
  var rect=rowEl.getBoundingClientRect();
  var panelW=280;var panelMaxH=320;
  var top=rect.bottom+2;var left=rect.left;
  if(top+panelMaxH>window.innerHeight)top=Math.max(2,rect.top-panelMaxH-2);
  if(left+panelW>window.innerWidth)left=window.innerWidth-panelW-2;
  if(left<2)left=2;
  qaPanel.style.top=top+'px';qaPanel.style.left=left+'px';
  qaSearchEl.focus();
  setTimeout(function(){
    qaOutsideClick=function(e){if(!qaPanel.contains(e.target))closeQA()};
    document.addEventListener('click',qaOutsideClick);
  },0);
}
function closeQA(){
  if(qaOutsideClick){document.removeEventListener('click',qaOutsideClick);qaOutsideClick=null}
  qaEl.classList.add('hidden');qaParentId=null;
}

qaSearchEl.addEventListener('input',function(){
  var q=qaSearchEl.value.trim().toLowerCase();
  if(!q){qaFiltered=CLASSES}
  else{
    qaFiltered=CLASSES.filter(function(c){return c.toLowerCase().indexOf(q)>=0});
    qaFiltered.sort(function(a,b){return(a.toLowerCase().indexOf(q)===0?0:1)-(b.toLowerCase().indexOf(q)===0?0:1)});
  }
  qaIdx=0;renderQA();
});

qaSearchEl.addEventListener('keydown',function(e){
  if(e.key==='Escape'){closeQA();e.stopPropagation()}
  else if(e.key==='Enter'){
    if(qaFiltered.length>0&&qaParentId){vscode.postMessage({type:'createInstance',parentId:qaParentId,className:qaFiltered[qaIdx]});closeQA()}
  }else if(e.key==='ArrowDown'){e.preventDefault();if(qaIdx<qaFiltered.length-1){qaIdx++;updateQASel()}}
  else if(e.key==='ArrowUp'){e.preventDefault();if(qaIdx>0){qaIdx--;updateQASel()}}
});

function renderQA(){
  var html='';
  for(var i=0;i<qaFiltered.length;i++){
    var c=qaFiltered[i];
    html+='<div class="qa-item'+(i===qaIdx?' selected':'')+'" data-cls="'+esc(c)+'">';
    html+='<img class="qa-icon" src="'+ASSET+'/'+esc(c)+'.png">';
    html+='<span>'+esc(c)+'</span></div>';
  }
  qaListEl.innerHTML=html;
}
function updateQASel(){
  qaListEl.querySelectorAll('.qa-item').forEach(function(el,i){el.classList.toggle('selected',i===qaIdx)});
  var sel=qaListEl.querySelector('.qa-item.selected');
  if(sel)sel.scrollIntoView({block:'nearest'});
}

qaListEl.addEventListener('click',function(e){
  var item=e.target.closest('.qa-item');
  if(!item||!qaParentId)return;
  vscode.postMessage({type:'createInstance',parentId:qaParentId,className:item.dataset.cls});
  closeQA();
});
qaListEl.addEventListener('mousemove',function(e){
  var item=e.target.closest('.qa-item');if(!item)return;
  var items=qaListEl.querySelectorAll('.qa-item');
  for(var i=0;i<items.length;i++){if(items[i]===item&&i!==qaIdx){qaIdx=i;updateQASel();break}}
});

document.addEventListener('keydown',function(e){if(e.key==='Escape'){hideCtx();closeQA()}});

/* ---- keyboard shortcuts (only when tree area has focus, not search or quick-add) ---- */
function isTreeFocused(){
  var ae=document.activeElement;
  if(!ae)return false;
  if(ae===searchEl||searchEl.contains(ae))return false;
  if(!qaEl.classList.contains('hidden')&&qaEl.contains(ae))return false;
  if(ae.closest&&ae.closest('.tree-rename-input'))return false;
  return treeEl.contains(ae)||ae===treeEl||ae===document.body;
}
document.addEventListener('keydown',function(e){
  if(!isTreeFocused())return;
  var nodeId=selectedIds.length>0?selectedIds[0]:null;
  var cmd=null;
  if(e.key==='Delete'){cmd='verde.deleteInstance';e.preventDefault()}
  else if((e.key==='F2'||e.key==='Enter')&&!renameNodeId&&nodeId){renameNodeId=nodeId;renderTree();afterRenameInputMount();e.preventDefault();return}
  else if((e.ctrlKey||e.metaKey)&&e.key==='c'){cmd='verde.copyInstance';e.preventDefault()}
  else if((e.ctrlKey||e.metaKey)&&e.key==='v'){cmd='verde.pasteInstance';e.preventDefault()}
  else if((e.ctrlKey||e.metaKey)&&e.key==='d'){cmd='verde.duplicateInstance';e.preventDefault()}
  else if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='a'){cmd='verde.addInstance';e.preventDefault()}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey){cmd='verde.undo';e.preventDefault()}
  else if((e.ctrlKey||e.metaKey)&&(e.key.toLowerCase()==='y'||(e.key.toLowerCase()==='z'&&e.shiftKey))){cmd='verde.redo';e.preventDefault()}
  if(cmd){
    if(nodeId)vscode.postMessage({type:'runCommand',command:cmd,nodeId:nodeId});
    else vscode.postMessage({type:'runCommand',command:cmd,nodeId:''});
  }
});
})();
</script>
</body>
</html>`;
  }
}
