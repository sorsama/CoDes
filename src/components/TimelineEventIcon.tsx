import type { TimelineEvent } from "../types";

export function TimelineEventIcon({ type }: { type: TimelineEvent["type"] }) {
  return (
    <svg className="timeline-event-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {type === "tool" ? <><path d="M5 4h14v16H5z"/><path d="m9 9-2 3 2 3M13 15h4"/></>
        : type === "approval" ? <><path d="M12 3 5 6v5c0 4.6 2.9 8 7 10 4.1-2 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-5"/></>
        : type === "failure" ? <><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17h.01"/></>
        : type === "prompt" ? <><path d="M4 5h16v12H8l-4 3z"/><path d="M8 9h8M8 13h5"/></>
        : <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/></>}
    </svg>
  );
}
