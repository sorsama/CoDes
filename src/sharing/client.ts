import type { AgentSession, ShareConnectionState, SharePermission } from "../types";
import { sessionRuntime } from "../lib/sessionRuntime";
import { decryptSignal, encryptSignal, EncryptedPeerSession, roomIdentity, signalEnvelopeSchema, type ShareMessage } from "./protocol";

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)), (char) => char.charCodeAt(0));
export const createInvite = (secret: Uint8Array) => `codes://share/${toBase64Url(secret)}`;
export const parseInvite = (invite: string) => { const url = new URL(invite); if (url.protocol !== "codes:" || url.hostname !== "share") throw new Error("This is not a CoDes sharing invitation."); return fromBase64Url(url.pathname.replace(/^\//, "")); };
export const inviteRoomIdentity = (invite: string) => roomIdentity(parseInvite(invite));
export async function confirmationPin(secret: Uint8Array) { const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", secret)); return String(((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000).padStart(6, "0"); }

export type ShareSnapshot = { role: "host" | "guest"; state: ShareConnectionState; invite?: string; pin?: string; permission: SharePermission; peerConnected: boolean; error?: string; output: string };
type Listener = (snapshot: ShareSnapshot) => void;

export class LiveShareSession {
  private ws?: WebSocket; private peer?: EncryptedPeerSession; private secret?: Uint8Array; private roomId?: string; private remoteId?: string; private outputUnsubscribe?: () => void; private listeners = new Set<Listener>();
  snapshot: ShareSnapshot = { role: "host", state: "idle", permission: "read", peerConnected: false, output: "" };
  subscribe(listener: Listener) { this.listeners.add(listener); listener(this.snapshot); return () => { this.listeners.delete(listener); }; }
  private patch(patch: Partial<ShareSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach((v) => v(this.snapshot)); }
  private setupPeer(iceServers: RTCIceServer[]) {
    const peer = new EncryptedPeerSession(iceServers); this.peer = peer;
    peer.onState = (state) => this.patch({ state: state === "connected" ? "connected" : state === "failed" ? "failed" : this.snapshot.state, peerConnected: state === "connected", error: state === "failed" ? "The peer connection failed. Check ICE/TURN configuration." : undefined });
    peer.onSignal = (signal) => void this.sendSignal(signal);
    peer.onMessage = (message) => void this.onPeerMessage(message);
    return peer;
  }
  private async sendSignal(signal: Parameters<typeof encryptSignal>[2]) { if (!this.ws || !this.secret || !this.remoteId) return; const envelope = await encryptSignal(this.secret, this.peer!.id, signal, this.remoteId); this.ws.send(JSON.stringify({ type: "signal", ...envelope })); }
  private async onPeerMessage(message: ShareMessage) {
    if (message.type === "output" && this.snapshot.role === "guest") this.patch({ output: (this.snapshot.output + message.data).slice(-250_000) });
    if (message.type === "input" && this.snapshot.role === "host" && this.snapshot.permission === "write-approved") { const active = this.sharedSession; if (active) await sessionRuntime.send(active.id, message.data); }
    if (message.type === "revoke") this.close("Invitation revoked");
  }
  private sharedSession?: AgentSession;
  async host(relayUrl: string, iceServers: RTCIceServer[], session: AgentSession, allowWrite: boolean) {
    this.close(); this.sharedSession = session; this.secret = crypto.getRandomValues(new Uint8Array(32)); this.roomId = await roomIdentity(this.secret); const peer = this.setupPeer(iceServers);
    const invite = createInvite(this.secret); const pin = await confirmationPin(this.secret); this.patch({ role: "host", state: "connecting", invite, pin, permission: allowWrite ? "write-pending" : "read", output: "", error: undefined });
    await this.connect(relayUrl, { type: "create", roomId: this.roomId, peerId: peer.id });
    this.outputUnsubscribe = sessionRuntime.subscribeOutput(session, (data) => peer.sendTerminalOutput(data));
  }
  async join(relayUrl: string, iceServers: RTCIceServer[], invite: string) {
    const secret = parseInvite(invite); const roomId = await roomIdentity(secret);
    if (this.snapshot.role === "host" && this.snapshot.state !== "idle" && roomId === this.roomId) throw new Error("You are already hosting this invitation. Open it in another CoDes app or device to join.");
    this.close(); this.secret = secret; this.roomId = roomId; const peer = this.setupPeer(iceServers); const pin = await confirmationPin(this.secret); this.patch({ role: "guest", state: "connecting", invite, pin, permission: "read", output: "", error: undefined });
    await this.connect(relayUrl, { type: "join", roomId: this.roomId, peerId: peer.id });
  }
  private connect(relayUrl: string, hello: object) {
    return new Promise<void>((resolve, reject) => {
      let target: URL;
      try { target = new URL(relayUrl); } catch { reject(new Error("The signaling relay URL is invalid.")); return; }
      const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
      if (target.protocol !== "wss:" && !(target.protocol === "ws:" && local)) { reject(new Error("Remote signaling relays must use wss://.")); return; }

      let settled = false;
      const ready = () => { if (!settled) { settled = true; resolve(); } };
      const fail = (error: Error) => {
        this.patch({ state: "failed", error: error.message });
        if (!settled) { settled = true; reject(error); }
      };
      const ws = new WebSocket(target);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onerror = () => fail(new Error("Could not connect to the signaling relay. Start the local relay or check its URL in Settings."));
      ws.onmessage = (event) => {
        let message: Record<string, unknown>;
        try { message = JSON.parse(String(event.data)) as Record<string, unknown>; }
        catch { fail(new Error("The relay returned an invalid message.")); return; }
        void this.onRelayMessage(message, ready).catch(() => fail(new Error("The relay returned an invalid message.")));
      };
      ws.onclose = () => {
        if (this.snapshot.state === "idle" || this.snapshot.error) return;
        fail(new Error(this.snapshot.peerConnected ? "The signaling relay disconnected; the peer connection is still active." : "The signaling relay disconnected before the invitation was ready."));
      };
    });
  }
  private async onRelayMessage(message: Record<string, unknown>, ready: () => void) {
    if (message.type === "created") { this.patch({ state: "waiting" }); ready(); }
    if (message.type === "joined") { this.remoteId = String(message.hostId); this.patch({ state: "waiting" }); ready(); }
    if (message.type === "peer-joined" && this.snapshot.role === "host") { this.remoteId = String(message.peerId); await this.peer?.createOffer(); }
    if (message.type === "signal" && this.secret) { const envelope = signalEnvelopeSchema.parse(message); this.remoteId = envelope.senderId; await this.peer?.accept(await decryptSignal(this.secret, envelope)); }
    if (message.type === "room-closed") this.close(message.reason === "expired" ? "Invitation expired" : "Room closed");
    if (message.type === "peer-left") this.patch({ peerConnected: false, state: "waiting" });
    if (message.type === "error") this.patch({ state: message.code === "room_not_found" ? "expired" : "failed", error: String(message.code).replace(/_/g, " ") });
  }
  approveWrite() { if (this.snapshot.role !== "host") return; this.patch({ permission: "write-approved" }); this.peer?.approveWrite(); this.peer?.send({ version: 1, type: "permission", permission: "write-approved" }); }
  revokeWrite() { this.patch({ permission: "read" }); if (this.peer) this.peer.permission = "read"; this.peer?.send({ version: 1, type: "permission", permission: "read" }); }
  sendInput(data: string) { this.peer?.sendTerminalInput(data); }
  close(reason?: string) { this.peer?.send({ version: 1, type: "revoke" }); this.outputUnsubscribe?.(); this.outputUnsubscribe = undefined; this.peer?.close(); this.peer = undefined; this.ws?.close(); this.ws = undefined; this.secret = undefined; this.roomId = undefined; this.remoteId = undefined; this.sharedSession = undefined; this.patch({ state: reason === "Invitation expired" ? "expired" : "idle", peerConnected: false, error: reason, invite: undefined, pin: undefined, output: "" }); }
}
