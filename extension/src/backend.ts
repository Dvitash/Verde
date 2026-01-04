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
    | { type: "create_instance"; parentId: string; className: string };

export type OperationResult =
    | { success: true; data?: string }
    | { success: false; error: string };

type RobloxInboundMessage =
    | { type: "explorer_snapshot"; requestId?: string; payload?: Snapshot }
    | { type: "operation_result"; requestId?: string; operationId: string; result: OperationResult }
    | { type: "handshake"; timestamp: number }
    | { type: "ack"; timestamp: number }
    | { type: string; requestId?: string; payload?: unknown };

type BackendOutboundMessage =
    | { type: "ack"; requestId?: string }
    | { type: "error"; requestId?: string; message: string }
    | { type: "operation"; requestId?: string; operationId: string; operation: Operation }
    | { type: "request_snapshot"; requestId?: string };

export class RblxExplorerBackend {
    private readonly outputChannel: vscode.OutputChannel;
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly onSnapshotReceived: (snapshot: Snapshot) => void;
    private readonly onConnectionLost?: () => void;

    private webSocketServer: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private operationCallbacks: Map<string, (result: OperationResult) => void> = new Map();
    private lastAckTime: number = 0;
    private ackTimeout: NodeJS.Timeout | null = null;

    constructor(
        outputChannel: vscode.OutputChannel,
        statusBarItem: vscode.StatusBarItem,
        onSnapshotReceived: (snapshot: Snapshot) => void,
        onConnectionLost?: () => void
    ) {
        this.outputChannel = outputChannel;
        this.statusBarItem = statusBarItem;
        this.onSnapshotReceived = onSnapshotReceived;
        this.onConnectionLost = onConnectionLost;
        this.updateStatusBar();
    }

    public async start(): Promise<void> {
        if (this.webSocketServer) {
            return;
        }

        const config = vscode.workspace.getConfiguration("rblxexplorer");
        const port = config.get<number>("port", 9000);
        const host = config.get<string>("host", "127.0.0.1");

        this.log(`starting websocket server on ws://${host}:${port}`);

        this.webSocketServer = new WebSocketServer({ host, port });

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
        });

        this.webSocketServer.on("error", (err) => {
            this.log(`server error: ${String(err)}`);
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

                this.send(socket, { type: "ack", requestId: message.requestId });
                return;
            }

            case "operation_result": {
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
                this.send(socket, { type: "ack" });
                return;
            }

            case "ack": {
                this.lastAckTime = Date.now();
                this.resetAckTimeout();
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

    private resetAckTimeout(): void {
        if (this.ackTimeout) {
            clearTimeout(this.ackTimeout);
            this.ackTimeout = null;
        }

        this.ackTimeout = setTimeout(() => {
            this.log("ACK timeout - connection lost");
            if (this.onConnectionLost) {
                this.onConnectionLost();
            }
        }, 1250);
    }

    private updateStatusBar(): void {
        const running = this.webSocketServer !== null;
        const clientCount = this.clients.size;

        this.statusBarItem.text = running
            ? `RblxExplorer: ${clientCount} client(s)`
            : "RblxExplorer: stopped";

        this.statusBarItem.show();
    }

    private log(message: string): void {
        this.outputChannel.appendLine(`[rblxexplorer] ${message}`);
    }
}
