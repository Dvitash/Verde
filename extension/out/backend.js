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
exports.RblxExplorerBackend = void 0;
const vscode = __importStar(require("vscode"));
const ws_1 = require("ws");
class RblxExplorerBackend {
    outputChannel;
    statusBarItem;
    onSnapshotReceived;
    onConnectionLost;
    webSocketServer = null;
    clients = new Set();
    operationCallbacks = new Map();
    lastAckTime = 0;
    ackTimeout = null;
    constructor(outputChannel, statusBarItem, onSnapshotReceived, onConnectionLost) {
        this.outputChannel = outputChannel;
        this.statusBarItem = statusBarItem;
        this.onSnapshotReceived = onSnapshotReceived;
        this.onConnectionLost = onConnectionLost;
        this.updateStatusBar();
    }
    async start() {
        if (this.webSocketServer) {
            return;
        }
        const config = vscode.workspace.getConfiguration("rblxexplorer");
        const port = config.get("port", 9000);
        const host = config.get("host", "127.0.0.1");
        this.log(`starting websocket server on ws://${host}:${port}`);
        this.webSocketServer = new ws_1.WebSocketServer({ host, port });
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
    async stop() {
        if (!this.webSocketServer) {
            return;
        }
        for (const socket of this.clients) {
            try {
                socket.close();
            }
            catch {
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
    async requestSnapshot() {
        for (const socket of this.clients) {
            this.send(socket, { type: "request_snapshot" });
        }
    }
    async sendOperation(operation) {
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
    onMessage(socket, rawData) {
        const text = rawData.toString();
        let message;
        try {
            message = JSON.parse(text);
        }
        catch {
            this.send(socket, { type: "error", message: "invalid_json" });
            return;
        }
        switch (message.type) {
            case "explorer_snapshot": {
                const payload = message.payload;
                if (!payload ||
                    !Array.isArray(payload.nodes) ||
                    !Array.isArray(payload.rootIds)) {
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
                const operationResultMessage = message;
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
                this.send(socket, { type: "ack", requestId: message.requestId });
                return;
            }
        }
    }
    send(socket, message) {
        if (socket.readyState !== ws_1.WebSocket.OPEN) {
            return;
        }
        socket.send(JSON.stringify(message));
    }
    resetAckTimeout() {
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
    updateStatusBar() {
        const running = this.webSocketServer !== null;
        const clientCount = this.clients.size;
        this.statusBarItem.text = running
            ? `RblxExplorer: ${clientCount} client(s)`
            : "RblxExplorer: stopped";
        this.statusBarItem.show();
    }
    log(message) {
        this.outputChannel.appendLine(`[rblxexplorer] ${message}`);
    }
}
exports.RblxExplorerBackend = RblxExplorerBackend;
//# sourceMappingURL=backend.js.map