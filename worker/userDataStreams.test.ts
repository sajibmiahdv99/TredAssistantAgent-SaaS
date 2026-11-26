import { describe, it, expect } from "vitest";
import { mapBinanceOrderStatus, mapBybitWsOrderStatus } from "./userDataStreams.ts";

// These tests pin the REAL mapping functions exported by the stream module —
// a previous version of this file re-implemented the mapping inline, which let
// a "canceled" vs "cancelled" drift slip through (the DB check constraint uses
// the British spelling, so every cancel update from the stream was rejected).

describe("mapBinanceOrderStatus (ORDER_TRADE_UPDATE field X)", () => {
  it("maps terminal and live statuses to DB values", () => {
    expect(mapBinanceOrderStatus("FILLED")).toBe("filled");
    expect(mapBinanceOrderStatus("PARTIALLY_FILLED")).toBe("partial");
    expect(mapBinanceOrderStatus("CANCELED")).toBe("cancelled");
    expect(mapBinanceOrderStatus("EXPIRED")).toBe("cancelled");
    expect(mapBinanceOrderStatus("REJECTED")).toBe("rejected");
  });

  it("ignores statuses that REST polling covers", () => {
    expect(mapBinanceOrderStatus("NEW")).toBeNull();
    expect(mapBinanceOrderStatus("")).toBeNull();
  });

  it("never produces the non-DB spelling 'canceled'", () => {
    for (const s of ["FILLED", "PARTIALLY_FILLED", "CANCELED", "EXPIRED", "REJECTED", "NEW"]) {
      expect(mapBinanceOrderStatus(s)).not.toBe("canceled");
    }
  });
});

describe("mapBybitWsOrderStatus", () => {
  it("maps Bybit order statuses to DB values", () => {
    expect(mapBybitWsOrderStatus("Filled")).toBe("filled");
    expect(mapBybitWsOrderStatus("PartiallyFilled")).toBe("partial");
    expect(mapBybitWsOrderStatus("Cancelled")).toBe("cancelled");
    expect(mapBybitWsOrderStatus("Canceled")).toBe("cancelled");
    expect(mapBybitWsOrderStatus("PartiallyFilledCanceled")).toBe("cancelled");
    expect(mapBybitWsOrderStatus("Deactivated")).toBe("cancelled");
    expect(mapBybitWsOrderStatus("Rejected")).toBe("rejected");
  });

  it("ignores unknown/open statuses", () => {
    expect(mapBybitWsOrderStatus("New")).toBeNull();
    expect(mapBybitWsOrderStatus("")).toBeNull();
  });
});
