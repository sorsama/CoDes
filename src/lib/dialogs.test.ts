import { describe, expect, it } from "vitest";
import { appConfirm, appPrompt, getActiveDialog, settleDialog } from "./dialogs";

describe("app dialogs", () => {
  it("queues dialogs and resolves input without browser APIs", async () => {
    const confirm = appConfirm({ title: "Restart session?" });
    const prompt = appPrompt({ title: "Rename session", inputValue: "Agent" });

    expect(getActiveDialog()?.kind).toBe("confirm");
    settleDialog(true);
    await expect(confirm).resolves.toBe(true);
    expect(getActiveDialog()?.kind).toBe("input");

    settleDialog("Renamed agent");
    await expect(prompt).resolves.toBe("Renamed agent");
    expect(getActiveDialog()).toBeNull();
  });
});
