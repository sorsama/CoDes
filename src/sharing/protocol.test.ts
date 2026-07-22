import { describe, expect, it } from "vitest";
import { decryptSignal, encryptSignal, roomIdentity, signalEnvelopeSchema } from "./protocol";

describe("encrypted sharing protocol", () => {
  it("derives a stable opaque room identity", async () => {
    const secret = new Uint8Array(16).fill(7);
    expect(await roomIdentity(secret)).toBe(await roomIdentity(secret));
    expect(await roomIdentity(secret)).toHaveLength(28);
  });

  it("round-trips signaling without exposing its contents", async () => {
    const secret = crypto.getRandomValues(new Uint8Array(16));
    const senderId = crypto.randomUUID();
    const signal = { type: "candidate" as const, candidate: { candidate: "candidate:private-address" } };
    const envelope = await encryptSignal(secret, senderId, signal);
    expect(signalEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.ciphertext).not.toContain("private-address");
    await expect(decryptSignal(secret, envelope)).resolves.toEqual(signal);
  });

  it("rejects an invitation with the wrong secret", async () => {
    const envelope = await encryptSignal(new Uint8Array(16).fill(1), crypto.randomUUID(), { type: "revoke" });
    await expect(decryptSignal(new Uint8Array(16).fill(2), envelope)).rejects.toThrow("Invitation does not match");
  });
});
