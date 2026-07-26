import { describe, expect, it } from "vitest";
import {
  branchIsProtected,
  buildCommitGraph,
  detectSecretRisk,
  mayAutoApplyGitProposal,
  parseGitProposal,
} from "./GitWorkspace";

describe("Git AI proposal safety", () => {
  it("requires the proposal to preserve the exact selected path set", () => {
    expect(() =>
      parseGitProposal(
        JSON.stringify({
          summary: "Split changes",
          findings: [],
          commitGroups: [
            { paths: ["src/a.ts"], message: "feat: update a" },
          ],
        }),
        "C:\\repo",
        "snapshot",
        "codex",
        new Set(["src/a.ts", "src/b.ts"]),
      ),
    ).toThrow(/selected file scope/i);
  });

  it("rejects files outside the reviewed selection", () => {
    expect(() =>
      parseGitProposal(
        JSON.stringify({
          summary: "Unexpected file",
          findings: [],
          commitGroups: [
            {
              paths: ["src/a.ts", ".env"],
              message: "feat: update files",
            },
          ],
        }),
        "C:\\repo",
        "snapshot",
        "codex",
        new Set(["src/a.ts"]),
      ),
    ).toThrow(/outside the selected scope/i);
  });

  it("rejects a selected path repeated across commit groups", () => {
    expect(() =>
      parseGitProposal(
        JSON.stringify({
          commitGroups: [
            { paths: ["src/a.ts"], message: "feat: first" },
            { paths: ["src/a.ts"], message: "feat: duplicate" },
          ],
        }),
        "C:\\repo",
        "snapshot",
        "codex",
        new Set(["src/a.ts"]),
      ),
    ).toThrow(/valid commit groups/i);
  });

  it("accepts selected directory shorthand and trailing provider warnings", () => {
    const proposal = parseGitProposal(
      `status: reviewing
{"summary":"Ready","findings":[],"commitGroups":[{"paths":["docs/"],"message":"docs: update guides"},{"paths":["src/app.ts"],"message":"feat: update app"}]}
jetski: a command permission was denied`,
      "C:\\repo",
      "snapshot",
      "antigravity",
      new Set(["docs/setup.md", "docs/usage.md", "src/app.ts"]),
    );
    expect(proposal.commitGroups[0].paths).toEqual([
      "docs/setup.md",
      "docs/usage.md",
    ]);
  });

  it("matches protected branch glob patterns", () => {
    expect(branchIsProtected("main", ["main", "release/*"])).toBe(true);
    expect(branchIsProtected("release/1.2", ["main", "release/*"])).toBe(true);
    expect(branchIsProtected("feature/git", ["main", "release/*"])).toBe(
      false,
    );
  });

  it("does not treat token-shaped source identifiers as credentials", () => {
    expect(
      detectSecretRisk(
        ["src/usage.ts", ".env.example"],
        `+const inputTokens = usage.inputTokens;\n+type Token = string;\n+apiKey: process.env.OPENAI_API_KEY`,
      ),
    ).toBeUndefined();
  });

  it("stops on high-confidence credential evidence", () => {
    expect(
      detectSecretRisk(
        ["src/config.ts"],
        `+api_key = "live_A91kLm7pQr4sTu8vWx2y"`,
      ),
    ).toMatch(/credential-like literal/i);
    expect(
      detectSecretRisk([".env.local"], "+FEATURE_FLAG=true"),
    ).toMatch(/sensitive file/i);
  });

  it("keeps full auto paused after a credential warning override", () => {
    expect(mayAutoApplyGitProposal("full_auto")).toBe(true);
    expect(
      mayAutoApplyGitProposal(
        "full_auto",
        "A credential-like literal was assigned in the diff.",
      ),
    ).toBe(false);
    expect(mayAutoApplyGitProposal("verify_first")).toBe(false);
  });

  it("builds stable lanes for branch and merge commits", () => {
    const rows = buildCommitGraph([
      {
        hash: "merge",
        subject: "merge",
        author: "CoDes",
        timestamp: 3,
        parents: ["main", "feature"],
      },
      {
        hash: "feature",
        subject: "feature",
        author: "CoDes",
        timestamp: 2,
        parents: ["main"],
      },
      {
        hash: "main",
        subject: "main",
        author: "CoDes",
        timestamp: 1,
        parents: [],
      },
    ]);
    expect(rows[0].parentLanes).toEqual([0, 1]);
    expect(rows[1].lane).toBe(1);
    expect(rows[2].lane).toBe(0);
  });
});
