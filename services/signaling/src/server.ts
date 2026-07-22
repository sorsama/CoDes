import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? (process.env.VITEST ? 0 : 8787));
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? 15 * 60_000);
const MAX_MESSAGE_BYTES = 96 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 100;
const MAX_ROOM_PEERS = 2;

const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create"), roomId: z.string().min(16).max(128), peerId: z.string().uuid() }),
  z.object({ type: z.literal("join"), roomId: z.string().min(16).max(128), peerId: z.string().uuid() }),
  z.object({ type: z.literal("signal"), roomId: z.string().min(16).max(128), senderId: z.string().uuid(), recipientId: z.string().uuid().optional(), nonce: z.string().min(16), ciphertext: z.string().min(16).max(MAX_MESSAGE_BYTES) }),
  z.object({ type: z.literal("leave"), roomId: z.string().min(16).max(128), peerId: z.string().uuid() }),
]);

type Peer = { id: string; socket: WebSocket };
type Room = { id: string; hostId: string; expiresAt: number; peers: Map<string, Peer> };
const rooms = new Map<string, Room>();
const rates = new Map<string, { start: number; count: number }>();

export const server = createServer((request, response) => {
  if (request.url === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  response.writeHead(404).end();
});
export const wss = new WebSocketServer({ server, path: "/signal", maxPayload: MAX_MESSAGE_BYTES });

function send(socket: WebSocket, message: unknown) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function limited(ip: string) { const now = Date.now(); const current = rates.get(ip); if (!current || now - current.start > RATE_WINDOW_MS) { rates.set(ip, { start: now, count: 1 }); return false; } current.count += 1; return current.count > RATE_LIMIT; }
function leave(socket: WebSocket) { for (const [roomId, room] of rooms) { for (const [peerId, peer] of room.peers) if (peer.socket === socket) { room.peers.delete(peerId); for (const remaining of room.peers.values()) send(remaining.socket, { type: "peer-left", roomId, peerId }); if (peerId === room.hostId || room.peers.size === 0) { for (const remaining of room.peers.values()) send(remaining.socket, { type: "room-closed", roomId }); rooms.delete(roomId); } } } }

wss.on("connection", (socket, request) => {
  const connectionId = randomUUID(); const ip = request.socket.remoteAddress ?? "unknown";
  send(socket, { type: "connected", connectionId, protocol: 1 });
  socket.on("message", (raw) => {
    if (limited(ip)) { send(socket, { type: "error", code: "rate_limited" }); socket.close(1008, "rate limited"); return; }
    let message: z.infer<typeof requestSchema>; try { message = requestSchema.parse(JSON.parse(raw.toString())); } catch { send(socket, { type: "error", code: "invalid_message" }); return; }
    if (message.type === "create") { if (rooms.has(message.roomId)) { send(socket, { type: "error", code: "room_exists" }); return; } const expiresAt = Date.now() + ROOM_TTL_MS; rooms.set(message.roomId, { id: message.roomId, hostId: message.peerId, expiresAt, peers: new Map([[message.peerId, { id: message.peerId, socket }]]) }); send(socket, { type: "created", roomId: message.roomId, expiresAt }); return; }
    const room = rooms.get(message.roomId); if (!room || room.expiresAt <= Date.now()) { rooms.delete(message.roomId); send(socket, { type: "error", code: "room_not_found" }); return; }
    if (message.type === "join") { if (room.peers.has(message.peerId)) { send(socket, { type: "error", code: "peer_exists" }); return; } if (room.peers.size >= MAX_ROOM_PEERS) { send(socket, { type: "error", code: "room_full" }); return; } room.peers.set(message.peerId, { id: message.peerId, socket }); for (const peer of room.peers.values()) if (peer.id !== message.peerId) send(peer.socket, { type: "peer-joined", roomId: room.id, peerId: message.peerId }); send(socket, { type: "joined", roomId: room.id, hostId: room.hostId, peers: [...room.peers.keys()] }); return; }
    if (message.type === "leave") { const peer = room.peers.get(message.peerId); if (!peer || peer.socket !== socket) { send(socket, { type: "error", code: "peer_mismatch" }); return; } room.peers.delete(message.peerId); send(socket, { type: "left", roomId: room.id }); if (message.peerId === room.hostId) { for (const remaining of room.peers.values()) send(remaining.socket, { type: "room-closed", roomId: room.id }); rooms.delete(room.id); } else { for (const remaining of room.peers.values()) send(remaining.socket, { type: "peer-left", roomId: room.id, peerId: message.peerId }); } return; }
    const sender = room.peers.get(message.senderId); if (!sender || sender.socket !== socket) { send(socket, { type: "error", code: "sender_mismatch" }); return; }
    const targets = message.recipientId ? [room.peers.get(message.recipientId)].filter(Boolean) as Peer[] : [...room.peers.values()].filter((peer) => peer.id !== message.senderId);
    for (const peer of targets) send(peer.socket, { type: "signal", version: 1, roomId: message.roomId, senderId: message.senderId, recipientId: message.recipientId, nonce: message.nonce, ciphertext: message.ciphertext });
  });
  socket.on("close", () => leave(socket)); socket.on("error", () => leave(socket));
});

setInterval(() => { const now = Date.now(); for (const [id, room] of rooms) if (room.expiresAt <= now) { for (const peer of room.peers.values()) send(peer.socket, { type: "room-closed", roomId: id, reason: "expired" }); rooms.delete(id); } for (const [ip, rate] of rates) if (now - rate.start > RATE_WINDOW_MS * 2) rates.delete(ip); }, 15_000).unref();
server.listen(PORT, "0.0.0.0", () => process.stdout.write(`CoDes signaling relay listening on :${PORT}\n`));
