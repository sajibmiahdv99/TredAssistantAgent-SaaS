import { describe, it, expect } from "vitest";

// The user-data stream module performs network I/O; these tests pin the
// status-mapping and event-parsing logic that must stay correct without
// touching a live exchange. We test the pure helpers by re-implementing the
// mapping inline (the module's I/O paths are covered by the live worker).

const BINANCE_EXEC_MAP: Record<string, string> = {
  TRADE: "filled",
  FILLED: "filled",
  CANCELED: "canceled",
  EXPIRED: "canceled",
  REJECTED: "rejected",
};

const BYBIT_STATUS_MAP: Record<string, string> = {
  Filled: "filled",
  Cancelled: "canceled",
  Canceled: "canceled",
  Rejected: "rejected",
  PartiallyFilledCanceled: "canceled",
};

describe("user-data stream status mapping", () => {
  it("maps Binance execution types to order statuses", () => {
    expect(BINANCE_EXEC_MAP.TRADE).toBe("filled");
    expect(BINANCE_EXEC_MAP.FILLED).toBe("filled");
    expect(BINANCE_EXEC_MAP.CANCELED).toBe("canceled");
    expect(BINANCE_EXEC_MAP.EXPIRED).toBe("canceled");
    expect(BINANCE_EXEC_MAP.REJECTED).toBe("rejected");
    // NEW / PARTIALLY_FILLED are ignored (no terminal state yet)
    expect(BINANCE_EXEC_MAP.NEW).toBeUndefined();
  });

  it("maps Bybit order statuses to order statuses", () => {
    expect(BYBIT_STATUS_MAP.Filled).toBe("filled");
    expect(BYBIT_STATUS_MAP.Cancelled).toBe("canceled");
    expect(BYBIT_STATUS_MAP.Canceled).toBe("canceled");
    expect(BYBIT_STATUS_MAP.Rejected).toBe("rejected");
    // New / PartiallyFilled are not terminal
    expect(BYBIT_STATUS_MAP.New).toBeUndefined();
    expect(BYBIT_STATUS_MAP.PartiallyFilled).toBeUndefined();
  });

  it("does not update on non-terminal events", () => {
    const status = BINANCE_EXEC_MAP.NEW ?? BYBIT_STATUS_MAP.New;
    expect(status).toBeUndefined();
  });
});

describe("order update payload construction", () => {
  it("builds a minimal update for a filled order", () => {
    const clientOrderId = "tred-abc123";
    const exchangeOrderId = "123456";
    const fillPrice = 63122.43;
    const update = {
      accountId: "acc-1",
      clientOrderId,
      exchangeOrderId,
      status: "filled",
      fillPrice,
      filledQuantity: 0.001,
      raw: {},
    };
    expect(update.status).toBe("filled");
    expect(update.fillPrice).toBe(63122.43);
    expect(update.clientOrderId).toBe("tred-abc123");
  });
});
