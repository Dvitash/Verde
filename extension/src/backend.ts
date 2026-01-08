import * as vscode from "vscode";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { Snapshot } from "./robloxExplorerProvider";

export type Operation =
    | { type: "move_node"; nodeId: string; newParentId: string | null }
    | { type: "rename_instance"; nodeId: string; newName: string }
    | { type: "duplicate_instance"; nodeId: string }
    | { type: "delete_instance"; nodeId: string }
    | { type: "copy_instance"; nodeIds: string[] }
    | { type: "paste_instance"; targetNodeId: string | null }
    | { type: "create_instance"; parentId: string; className: string }
    | { type: "get_properties"; nodeId: string }
    | { type: "deselect_instance" }
    | { type: "set_property"; nodeId: string; propertyName: string; propertyValue: any }
    | { type: "add_tag"; nodeId: string; tagName: string }
    | { type: "remove_tag"; nodeId: string; tagName: string }
    | { type: "add_attribute"; nodeId: string; attributeName: string; attributeType: string }
    | { type: "set_attribute"; nodeId: string; attributeName: string; attributeValue: any }
    | { type: "remove_attribute"; nodeId: string; attributeName: string }
    | { type: "rename_attribute"; nodeId: string; oldName: string; newName: string }

export type OperationResult =
    | { success: true; data?: string | PropertiesData | boolean }
    | { success: false; error: string };

export type PropertyInfo = {
    name: string;
    type: string;
    value: any;
    category: string;
    isEnum?: boolean;
    enumValues?: { name: string; value: number }[];
    isInstanceReference?: boolean;
    referencedInstanceId?: string;
    referencedInstanceName?: string;
    referencedInstanceClass?: string;
};

export type AttributeInfo = {
    name: string;
    type: string;
    value: any;
};

export type PropertiesData = {
    properties: PropertyInfo[];
    tags: string[];
    attributes: AttributeInfo[];
};

export type TextRange = {
    start: { line: number; character: number };
    end: { line: number; character: number };
};

type RobloxInboundMessage =
    | { type: "explorer_snapshot"; requestId?: string; payload?: Snapshot }
    | { type: "operation_result"; requestId?: string; operationId: string; result: OperationResult }
    | { type: "property_update"; nodeId: string; properties: PropertiesData }
    | { type: "handshake"; timestamp: number }
    | { type: "ack"; timestamp: number }
    | { type: string; requestId?: string; payload?: unknown };

type BackendOutboundMessage =
    | { type: "ack"; requestId?: string }
    | { type: "error"; requestId?: string; message: string }
    | { type: "operation"; requestId?: string; operationId: string; operation: Operation }
    | { type: "request_snapshot"; requestId?: string };

export class VerdeBackend {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly onSnapshotReceived: (snapshot: Snapshot) => void;
    private readonly onConnectionLost?: () => void;
    private onPropertyUpdate?: (nodeId: string, properties: PropertiesData) => void;

    private webSocketServer: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private operationCallbacks: Map<string, (result: OperationResult) => void> = new Map();
    private lastAckTime: number = 0;
    private ackTimeout: NodeJS.Timeout | null = null;
    private ackInterval: NodeJS.Timeout | null = null;
    private nextSnapshotPromise: Promise<Snapshot> | null = null;
    private nextSnapshotResolve: ((snapshot: Snapshot) => void) | null = null;

    constructor(
        outputChannel: vscode.OutputChannel,
        statusBarItem: vscode.StatusBarItem,
        onSnapshotReceived: (snapshot: Snapshot) => void,
        onConnectionLost?: () => void,
    ) {
        this.outputChannel = outputChannel;
        this.statusBarItem = statusBarItem;
        this.onSnapshotReceived = onSnapshotReceived;
        this.onConnectionLost = onConnectionLost;
        this.updateStatusBar();
    }

    public async start(): Promise<void> {
        if (this.webSocketServer) {
            const addressInfo = this.webSocketServer.address();
            if (addressInfo) {
                this.log(`websocket server already running on ${JSON.stringify(addressInfo)}`);
                return;
            }

            await this.stop();
        }

        const config = vscode.workspace.getConfiguration("verde");
        const port = config.get<number>("port", 9000);
        const hostSetting = config.get<string>("host", "localhost");
        const host = hostSetting;

        this.log(`starting websocket server on ws://${host}:${port}`);

        try {
            this.webSocketServer = new WebSocketServer(host ? { host, port } : { port });
        } catch (err) {
            this.log(`failed to start websocket server: ${String(err)}`);
            throw err;
        }

        this.webSocketServer.on("listening", () => {
            this.log("websocket server listening");
        });

        this.webSocketServer.on("connection", (socket) => {
            this.clients.add(socket);
            this.log(`client connected (${this.clients.size} total)`);
            this.updateStatusBar();

            socket.on("message", (data) => this.onMessage(socket, data));
            socket.on("close", () => {
                this.clients.delete(socket);
                this.log(`client disconnected (${this.clients.size} total)`);
                this.updateStatusBar();
            });
            socket.on("error", (err) => {
                this.log(`socket error: ${String(err)}`);
            });

            this.lastAckTime = Date.now();
            this.startAckInterval();

            this.requestSnapshot();
        });

        this.webSocketServer.on("error", (err) => {
            this.log(`server error: ${String(err)}`);
            if ((err as any)?.code === "EADDRINUSE") {
                this.webSocketServer = null;
            }
        });
    }

    public async stop(): Promise<void> {
        if (!this.webSocketServer) {
            return;
        }

        for (const socket of this.clients) {
            try {
                socket.close();
            } catch {
                // ignore
            }
        }

        this.clients.clear();
        this.webSocketServer.close();
        this.webSocketServer = null;

        if (this.ackTimeout) {
            clearTimeout(this.ackTimeout);
            this.ackTimeout = null;
        }

        if (this.ackInterval) {
            clearInterval(this.ackInterval);
            this.ackInterval = null;
        }

        this.operationCallbacks.clear();
        this.updateStatusBar();
    }

    public async requestSnapshot(): Promise<void> {
        for (const socket of this.clients) {
            this.send(socket, { type: "request_snapshot" });
        }
    }

    public async sendOperation(operation: Operation): Promise<OperationResult> {
        return new Promise((resolve) => {
            const operationId = crypto.randomUUID();

            this.operationCallbacks.set(operationId, resolve);

            for (const socket of this.clients) {
                this.send(socket, {
                    type: "operation",
                    operationId,
                    operation
                });
            }

            setTimeout(() => {
                if (this.operationCallbacks.has(operationId)) {
                    this.operationCallbacks.delete(operationId);
                    resolve({ success: false, error: "timeout" });
                }
            }, 30000);
        });
    }

    public async getProperties(nodeId: string): Promise<PropertiesData> {
        const result = await this.sendOperation({ type: "get_properties", nodeId });
        if (result.success && result.data) {
            return result.data as PropertiesData;
        }
        throw new Error(result.success ? "No data returned" : result.error);
    }

    public setPropertyUpdateCallback(callback: (nodeId: string, properties: PropertiesData) => void): void {
        this.onPropertyUpdate = callback;
    }

    public async setProperty(nodeId: string, propertyName: string, propertyValue: any): Promise<void> {
        const result = await this.sendOperation({ type: "set_property", nodeId, propertyName, propertyValue });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async addTag(nodeId: string, tagName: string): Promise<void> {
        const result = await this.sendOperation({ type: "add_tag", nodeId, tagName });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async removeTag(nodeId: string, tagName: string): Promise<void> {
        const result = await this.sendOperation({ type: "remove_tag", nodeId, tagName });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async addAttribute(nodeId: string, attributeName: string, attributeType: string): Promise<void> {
        const result = await this.sendOperation({ type: "add_attribute", nodeId, attributeName, attributeType });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async setAttribute(nodeId: string, attributeName: string, attributeValue: any): Promise<void> {
        const result = await this.sendOperation({ type: "set_attribute", nodeId, attributeName, attributeValue });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async removeAttribute(nodeId: string, attributeName: string): Promise<void> {
        const result = await this.sendOperation({ type: "remove_attribute", nodeId, attributeName });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async renameAttribute(nodeId: string, oldName: string, newName: string): Promise<void> {
        const result = await this.sendOperation({ type: "rename_attribute", nodeId, oldName, newName });
        if (!result.success) {
            throw new Error(result.error);
        }
    }

    public async waitForNextSnapshot(): Promise<Snapshot> {
        if (this.nextSnapshotPromise) {
            return this.nextSnapshotPromise;
        }

        this.nextSnapshotPromise = new Promise((resolve) => {
            this.nextSnapshotResolve = resolve;
        });

        return this.nextSnapshotPromise;
    }

    private onMessage(socket: WebSocket, rawData: RawData): void {
        const text = rawData.toString();

        let message: RobloxInboundMessage;
        try {
            message = JSON.parse(text);
        } catch {
            this.send(socket, { type: "error", message: "invalid_json" });
            return;
        }

        switch (message.type) {
            case "explorer_snapshot": {
                this.lastAckTime = Date.now();
                const payload = message.payload as Snapshot;

                if (
                    !payload ||
                    !Array.isArray(payload.nodes) ||
                    !Array.isArray(payload.rootIds)
                ) {
                    this.send(socket, {
                        type: "error",
                        requestId: message.requestId,
                        message: "invalid_snapshot_payload"
                    });
                    return;
                }

                this.log(`received explorer snapshot (${payload.nodes.length} nodes)`);
                this.onSnapshotReceived(payload);

                if (this.nextSnapshotResolve) {
                    this.nextSnapshotResolve(payload);
                    this.nextSnapshotPromise = null;
                    this.nextSnapshotResolve = null;
                }

                this.send(socket, { type: "ack", requestId: message.requestId });
                return;
            }

            case "operation_result": {
                this.lastAckTime = Date.now();
                const operationResultMessage = message as { type: "operation_result"; operationId: string; result: OperationResult };
                const callback = this.operationCallbacks.get(operationResultMessage.operationId);

                if (callback) {
                    this.operationCallbacks.delete(operationResultMessage.operationId);
                    callback(operationResultMessage.result);
                }

                this.send(socket, { type: "ack", requestId: message.requestId });
                return;
            }

            case "handshake": {
                this.lastAckTime = Date.now();
                this.send(socket, { type: "ack" });
                return;
            }

            case "property_update": {
                this.lastAckTime = Date.now();
                const propertyUpdateMessage = message as { type: "property_update"; nodeId: string; properties: PropertiesData; requestId?: string };
                if (this.onPropertyUpdate) {
                    this.onPropertyUpdate(propertyUpdateMessage.nodeId, propertyUpdateMessage.properties);
                }
                this.send(socket, { type: "ack", requestId: propertyUpdateMessage.requestId });
                return;
            }

            case "ack": {
                this.lastAckTime = Date.now();
                this.log(`received ack from plugin`);
                return;
            }

            default: {
                this.log(`unhandled message type: ${message.type}`);
                this.send(socket, { type: "ack", requestId: (message as any).requestId });
                return;
            }
        }
    }

    private send(socket: WebSocket, message: BackendOutboundMessage): void {
        if (socket.readyState !== WebSocket.OPEN) {
            return;
        }

        socket.send(JSON.stringify(message));
    }

    private startAckInterval(): void {
        if (this.ackInterval) {
            return;
        }

        this.ackInterval = setInterval(() => {
            if (this.clients.size === 0) {
                if (this.ackInterval) {
                    clearInterval(this.ackInterval);
                    this.ackInterval = null;
                }
                return;
            }

            const now = Date.now();
            const timeSinceLastAck = now - this.lastAckTime;
            if (timeSinceLastAck > 5000) {

                const socketsToDisconnect: WebSocket[] = [];
                for (const socket of this.clients) {
                    socketsToDisconnect.push(socket);
                }

                for (const socket of socketsToDisconnect) {
                    try {
                        socket.close();
                    } catch {
                        // ignore
                    }
                    this.clients.delete(socket);
                }

                if (this.clients.size === 0 && this.onConnectionLost) {
                    this.onConnectionLost();
                }

                this.updateStatusBar();
                return;
            }

            for (const socket of this.clients) {
                this.send(socket, { type: "ack" });
            }
        }, 1000);
    }


    private updateStatusBar(): void {
        const running = this.webSocketServer !== null;
        const clientCount = this.clients.size;

        this.statusBarItem.text = running
            ? `Verde: ${clientCount} client(s)`
            : "Verde: stopped";

        this.statusBarItem.show();
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[verde] ${message}`);
    }
}
