import { describe, expect, it } from "vitest";
import { asBracketedTerminalPaste, buildHandoffPrompt } from "./handoff";

describe("handoff prompt", () => {
  it("delimits imported history and preserves repository verification", () => {
    const prompt = buildHandoffPrompt({ id: "s", projectId: "p", title: "Fix auth", provider: "codex", status: "completed", cwd: "C:\\work", createdAt: 1, unread: false }, "claude", { status: "ready", source: "codex-jsonl", sourceLabel: "Codex conversation", conversationAvailable: true, content: "[USER]\nFix it", charCount: 13, messageCount: 1, redactionCount: 0, omittedCount: 0 });
    expect(prompt).toContain("<codes_handoff");
    expect(prompt).toContain("[USER]\nFix it");
    expect(prompt).toContain("Verify the current working tree");
    expect(prompt).toContain("trust the repository");
  });

  it("sends multiline history as one bracketed terminal paste", () => {
    expect(asBracketedTerminalPaste("one\r\ntwo")).toBe("\u001b[200~one\ntwo\u001b[201~\r");
  });
});
