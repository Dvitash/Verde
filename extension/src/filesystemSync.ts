// file system sync for better rojo support

import * as vscode from "vscode";
import { SourcemapParser } from "./sourcemapParser";

const EXTENSION_MAP: Record<string, string> = {
	Script: ".server.luau",
	LocalScript: ".client.luau",
	ModuleScript: ".luau",
};

const INIT_PATTERN = /^init\./;
const SYNCABLE_CLASSES = new Set(["Script", "LocalScript", "ModuleScript", "Folder"]);

export function isSyncableClass(className: string): boolean {
	return SYNCABLE_CLASSES.has(className);
}

async function findUniquePath(dir: vscode.Uri, base: string, ext: string): Promise<vscode.Uri> {
	let uri = vscode.Uri.joinPath(dir, `${base}${ext}`);
	try { await vscode.workspace.fs.stat(uri); } catch { return uri; }
	for (let i = 2; i <= 99; i++) {
		uri = vscode.Uri.joinPath(dir, `${base}${i}${ext}`);
		try { await vscode.workspace.fs.stat(uri); } catch { return uri; }
	}
	throw new Error(`couldnt find unique name for "${base}" in ${dir.fsPath}`);
}

function resolveTarget(
	smp: SourcemapParser,
	instancePath: string[],
	className: string
): { uri: vscode.Uri; isDir: boolean } | null {
	const fp = smp.findFilePath(instancePath);
	if (fp) {
		const base = fp.fsPath.split(/[/\\]/).pop() || "";
		if (INIT_PATTERN.test(base)) {
			return { uri: vscode.Uri.joinPath(fp, ".."), isDir: true };
		}
		return { uri: fp, isDir: false };
	}
	if (className === "Folder") {
		const dir = smp.findDirectory(instancePath);
		return dir ? { uri: dir, isDir: true } : null;
	}
	return null;
}

async function ensureParentDirectory(
	smp: SourcemapParser,
	parentPath: string[]
): Promise<vscode.Uri | null> {
	const dir = smp.findDirectory(parentPath);
	if (dir) return dir;

	const parentFile = smp.findFilePath(parentPath);
	if (!parentFile) return null;

	const fileName = parentFile.fsPath.split(/[/\\]/).pop() || "";
	if (/^init\./.test(fileName)) return null;

	const ext = Object.values(EXTENSION_MAP).find(e => fileName.endsWith(e));
	if (!ext) return null;

	const scriptName = fileName.substring(0, fileName.length - ext.length);
	const parentDir = vscode.Uri.joinPath(parentFile, "..");
	const newDir = vscode.Uri.joinPath(parentDir, scriptName);
	const initFile = vscode.Uri.joinPath(newDir, `init${ext}`);

	await vscode.workspace.fs.createDirectory(newDir);
	await vscode.workspace.fs.rename(parentFile, initFile);

	return newDir;
}

export async function createOnFilesystem(
	smp: SourcemapParser,
	parentPath: string[],
	className: string
): Promise<{ created: boolean; fileUri?: vscode.Uri }> {
	let parentDir: vscode.Uri | null;
	try {
		parentDir = await ensureParentDirectory(smp, parentPath);
	} catch (e) {
		vscode.window.showWarningMessage(`couldnt prepare parent directory: ${e}`);
		return { created: false };
	}
	if (!parentDir) {
		vscode.window.showWarningMessage(
			`parent isnt mapped in sourcemap, falling back to studio creation`
		);
		return { created: false };
	}

	try {
		if (className === "Folder") {
			const uri = await findUniquePath(parentDir, className, "");
			await vscode.workspace.fs.createDirectory(uri);
			return { created: true, fileUri: uri };
		}

		const ext = EXTENSION_MAP[className];
		if (!ext) return { created: false };

		const uri = await findUniquePath(parentDir, className, ext);
		const template = className === "ModuleScript" ? "local module = {}\n\nreturn module\n" : "print(\"Hello world!\")\n";
		await vscode.workspace.fs.writeFile(uri, Buffer.from(template));
		return { created: true, fileUri: uri };
	} catch (e) {
		vscode.window.showWarningMessage(`failed to create on file system: ${e}`);
		return { created: false };
	}
}

export async function renameOnFilesystem(
	smp: SourcemapParser,
	instancePath: string[],
	className: string,
	newName: string
): Promise<{ success: boolean; oldUri?: vscode.Uri; newUri?: vscode.Uri }> {
	const target = resolveTarget(smp, instancePath, className);
	if (!target) return { success: false };

	try {
		const parentUri = vscode.Uri.joinPath(target.uri, "..");
		let newUri: vscode.Uri;

		if (target.isDir) {
			newUri = vscode.Uri.joinPath(parentUri, newName);
		} else {
			const fileName = target.uri.fsPath.split(/[/\\]/).pop() || "";
			const ext = Object.values(EXTENSION_MAP).find(e => fileName.endsWith(e)) || "";
			newUri = vscode.Uri.joinPath(parentUri, `${newName}${ext}`);
		}

		let targetExists = false;
		try { await vscode.workspace.fs.stat(newUri); targetExists = true; } catch { /* good */ }

		if (targetExists) {
			vscode.window.showWarningMessage(
				`cant rename: "${newName}" , already exists on the filesystem.`
			);
			return { success: false };
		}

		try {
			await vscode.workspace.fs.rename(target.uri, newUri);
		} catch (renameErr) {
			const msg = String(renameErr);
			if (msg.includes('EntryNotFound') || msg.includes('ENOENT') || msg.includes('EntryExists')) {
				return { success: true, oldUri: target.uri, newUri };
			}
			throw renameErr;
		}
		return { success: true, oldUri: target.uri, newUri };
	} catch (e) {
		vscode.window.showWarningMessage(`cant rename on filesystem: ${e}`);
		return { success: false };
	}
}

export async function deleteOnFilesystem(
	smp: SourcemapParser,
	instancePath: string[],
	className: string
): Promise<boolean> {
	const target = resolveTarget(smp, instancePath, className);
	if (!target) return false;

	try {
		await vscode.workspace.fs.delete(target.uri, { recursive: true });
		return true;
	} catch (e) {
		vscode.window.showWarningMessage(`fail to delete on filesystem: ${e}`);
		return false;
	}
}

export async function moveOnFilesystem(
	smp: SourcemapParser,
	instancePath: string[],
	className: string,
	newParentPath: string[]
): Promise<boolean> {
	const target = resolveTarget(smp, instancePath, className);
	if (!target) return false;

	let destDir: vscode.Uri | null;
	try {
		destDir = await ensureParentDirectory(smp, newParentPath);
	} catch (e) {
		vscode.window.showWarningMessage(`fail to prepare destination directory: ${e}`);
		return false;
	}
	if (!destDir) {
		vscode.window.showWarningMessage(
			`destination isnt mapped in sourcemap, falling back to studio move`
		);
		return false;
	}

	try {
		const name = target.uri.fsPath.split(/[/\\]/).pop() || "";
		const destUri = vscode.Uri.joinPath(destDir, name);

		try {
			await vscode.workspace.fs.stat(destUri);
			vscode.window.showWarningMessage(
				`cant move: "${name}" , already exists in the destination.`
			);
			return false;
		} catch { /* doesn't exist, safe */ }

		await vscode.workspace.fs.rename(target.uri, destUri);
		return true;
	} catch (e) {
		vscode.window.showWarningMessage(`fail to move on filesystem: ${e}`);
		return false;
	}
}
