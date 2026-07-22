import { describe, expect, it } from "vitest";
import { confirmationPin, createInvite, inviteRoomIdentity, LiveShareSession, parseInvite } from "./client";
import { decryptSignal, encryptSignal, roomIdentity, shareMessageSchema } from "./protocol";

describe("sharing invitations", () => {
  it("round trips a base64url secret without putting a PIN in the URL", async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const invite = createInvite(secret);
    expect(invite).toMatch(/^codes:\/\/share\/[A-Za-z0-9_-]+$/);
    expect(invite).not.toContain("pin=");
    expect([...parseInvite(invite)]).toEqual([...secret]);
    expect(await inviteRoomIdentity(invite)).toBe(await roomIdentity(secret));
    expect(await confirmationPin(secret)).toMatch(/^\d{6}$/);
  });

  it("encrypts and authenticates signaling envelopes", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const sender = crypto.randomUUID();
    const envelope = await encryptSignal(secret, sender, { type: "revoke" });
    expect(await decryptSignal(secret, envelope)).toEqual({ type: "revoke" });
    await expect(decryptSignal(crypto.getRandomValues(new Uint8Array(32)), envelope)).rejects.toThrow();
  });

  it("keeps the host room active when its own invitation is entered", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const invite = createInvite(secret);
    const live = new LiveShareSession();
    live.snapshot = { role: "host", state: "waiting", invite, permission: "read", peerConnected: false, output: "" };
    (live as unknown as { roomId: string }).roomId = await roomIdentity(secret);

    await expect(live.join("ws://localhost:8787/signal", [], invite)).rejects.toThrow("already hosting");
    expect(live.snapshot).toMatchObject({ role: "host", state: "waiting", invite });
  });

  it("rejects malformed or oversized data-channel messages", () => {
    expect(shareMessageSchema.safeParse({ version: 1, type: "input", data: "ls\r" }).success).toBe(true);
    expect(shareMessageSchema.safeParse({ version: 1, type: "permission", permission: "owner" }).success).toBe(false);
    expect(shareMessageSchema.safeParse({ version: 1, type: "input", data: "x".repeat(20_000) }).success).toBe(false);
  });
});
