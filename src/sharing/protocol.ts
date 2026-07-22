import { z } from "zod";

export const signalEnvelopeSchema = z.object({
  version: z.literal(1),
  roomId: z.string().min(16).max(128),
  senderId: z.string().uuid(),
  recipientId: z.string().uuid().optional(),
  nonce: z.string().min(16),
  ciphertext: z.string().min(16),
});

export type SignalEnvelope = z.infer<typeof signalEnvelopeSchema>;
export type PeerPermission = "read" | "write-pending" | "write-approved";
export type InnerSignal = { type: "offer" | "answer"; sdp: RTCSessionDescriptionInit } | { type: "candidate"; candidate: RTCIceCandidateInit } | { type: "revoke" };
export const shareMessageSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("hello"), role: z.enum(["host", "guest"]) }),
  z.object({ version: z.literal(1), type: z.literal("output"), data: z.string().max(262_144) }),
  z.object({ version: z.literal(1), type: z.literal("input"), data: z.string().max(16_384) }),
  z.object({ version: z.literal(1), type: z.literal("permission"), permission: z.enum(["read", "write-pending", "write-approved"]) }),
  z.object({ version: z.literal(1), type: z.literal("revoke") }),
]);
export type ShareMessage = z.infer<typeof shareMessageSchema>;

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function deriveKey(secret: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("codes-share-v1"), info: new TextEncoder().encode("signaling") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function roomIdentity(secret: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", secret));
  return bytesToBase64(digest).replace(/[+/=]/g, "").slice(0, 28);
}

export async function encryptSignal(secret: Uint8Array, senderId: string, signal: InnerSignal, recipientId?: string): Promise<SignalEnvelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const roomId = await roomIdentity(secret); const key = await deriveKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode(roomId) }, key, new TextEncoder().encode(JSON.stringify(signal)));
  return { version: 1, roomId, senderId, recipientId, nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSignal(secret: Uint8Array, envelope: SignalEnvelope): Promise<InnerSignal> {
  const parsed = signalEnvelopeSchema.parse(envelope); const expectedRoom = await roomIdentity(secret);
  if (parsed.roomId !== expectedRoom) throw new Error("Invitation does not match this room");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(parsed.nonce), additionalData: new TextEncoder().encode(parsed.roomId) }, await deriveKey(secret), base64ToBytes(parsed.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as InnerSignal;
}

export class EncryptedPeerSession {
  readonly id = crypto.randomUUID();
  readonly connection: RTCPeerConnection;
  channel?: RTCDataChannel;
  permission: PeerPermission = "read";
  onSignal?: (signal: InnerSignal) => void;
  onTerminalData?: (data: string) => void;
  onMessage?: (message: ShareMessage) => void;
  onState?: (state: RTCPeerConnectionState) => void;

  constructor(iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }]) {
    this.connection = new RTCPeerConnection({ iceServers });
    this.connection.onicecandidate = (event) => { if (event.candidate) this.onSignal?.({ type: "candidate", candidate: event.candidate.toJSON() }); };
    this.connection.ondatachannel = (event) => this.attachChannel(event.channel);
    this.connection.onconnectionstatechange = () => this.onState?.(this.connection.connectionState);
  }
  private attachChannel(channel: RTCDataChannel) { this.channel = channel; channel.onmessage = (event) => { const raw = String(event.data); try { const message = shareMessageSchema.parse(JSON.parse(raw)); if (message.type === "output") this.onTerminalData?.(message.data); if (message.type === "permission") this.permission = message.permission; this.onMessage?.(message); } catch { /* malformed peer messages are ignored */ } }; }
  async createOffer() { this.attachChannel(this.connection.createDataChannel("terminal", { ordered: true })); const offer = await this.connection.createOffer(); await this.connection.setLocalDescription(offer); this.onSignal?.({ type: "offer", sdp: offer }); }
  async accept(signal: InnerSignal) {
    if (signal.type === "candidate") await this.connection.addIceCandidate(signal.candidate);
    if (signal.type === "offer") { await this.connection.setRemoteDescription(signal.sdp); const answer = await this.connection.createAnswer(); await this.connection.setLocalDescription(answer); this.onSignal?.({ type: "answer", sdp: answer }); }
    if (signal.type === "answer") await this.connection.setRemoteDescription(signal.sdp);
    if (signal.type === "revoke") this.close();
  }
  approveWrite() { this.permission = "write-approved"; }
  send(message: ShareMessage) { if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(message)); }
  sendTerminalOutput(data: string) { this.send({ version: 1, type: "output", data }); }
  sendTerminalInput(data: string) { if (this.permission !== "write-approved") throw new Error("Remote input has not been approved"); this.send({ version: 1, type: "input", data }); }
  close() { this.channel?.close(); this.connection.close(); }
}
