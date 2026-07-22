import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { server, wss } from "./server.js";

let endpoint = "";
beforeAll(async () => {
  if (!server.listening) await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Relay did not bind a TCP port");
  endpoint = `ws://127.0.0.1:${address.port}/signal`;
});
afterAll(async () => { await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))); });

const connect = () => new Promise<WebSocket>((resolve, reject) => { const socket = new WebSocket(endpoint); socket.once("message", () => resolve(socket)); socket.once("error", reject); });
const next = (socket: WebSocket) => new Promise<Record<string, unknown>>((resolve) => socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))));
const send = async (socket: WebSocket, message: object) => { const response = next(socket); socket.send(JSON.stringify(message)); return response; };

describe("signaling relay membership", () => {
  it("rejects duplicate peers and forged senders", async () => {
    const host = await connect();
    const guest = await connect();
    const attacker = await connect();
    const roomId = "room-identity-1234567890"; const hostId = crypto.randomUUID(); const guestId = crypto.randomUUID();
    expect((await send(host, { type: "create", roomId, peerId: hostId })).type).toBe("created");
    const hostNotice = next(host); expect((await send(guest, { type: "join", roomId, peerId: guestId })).type).toBe("joined"); await hostNotice;
    expect((await send(attacker, { type: "join", roomId, peerId: guestId })).code).toBe("peer_exists");
    expect((await send(attacker, { type: "signal", roomId, senderId: hostId, nonce: "1234567890123456", ciphertext: "1234567890123456" })).code).toBe("sender_mismatch");
    host.close(); guest.close(); attacker.close();
  });
});
