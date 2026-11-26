import { describe, it, expect } from "vitest";
import { planNewMessages } from "./channelPoller.ts";

// Cursor-loss regression: the poller used to advance last_processed_message_id
// to the newest FETCHED id, even when ingestion of some messages failed —
// permanently dropping signals. These tests pin the planning helper that keeps
// ingestion ordered and the cursor honest.

describe("planNewMessages", () => {
  it("returns messages oldest-first", () => {
    const msgs = [{ id: 12 }, { id: 9 }, { id: 11 }];
    expect(planNewMessages(msgs, null).map((m) => m.id)).toEqual([9, 11, 12]);
  });

  it("drops already-processed ids (cursor is inclusive)", () => {
    const msgs = [{ id: 9 }, { id: 10 }, { id: 11 }];
    expect(planNewMessages(msgs, 10).map((m) => m.id)).toEqual([11]);
  });

  it("dedupes repeated ids from the fetch", () => {
    const msgs = [{ id: 9 }, { id: 9 }, { id: 10 }];
    expect(planNewMessages(msgs, null).map((m) => m.id)).toEqual([9, 10]);
  });

  it("keeps everything when there is no cursor yet", () => {
    const msgs = [{ id: 100 }, { id: 50 }];
    expect(planNewMessages(msgs, null)).toHaveLength(2);
  });

  it("returns an empty list when nothing is new", () => {
    expect(planNewMessages([{ id: 5 }, { id: 6 }], 6)).toEqual([]);
  });
});
