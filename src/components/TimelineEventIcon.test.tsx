import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../types";
import { TimelineEventIcon } from "./TimelineEventIcon";

describe("TimelineEventIcon", () => {
  it("renders every event type without leaking icon ligature text", () => {
    const types: TimelineEvent["type"][] = ["prompt", "tool", "approval", "failure", "status"];
    const markup = types.map((type) => renderToStaticMarkup(<TimelineEventIcon type={type}/>)).join("");

    expect(markup.match(/<svg/g)).toHaveLength(types.length);
    expect(markup).not.toContain("chat_bubble");
  });
});
