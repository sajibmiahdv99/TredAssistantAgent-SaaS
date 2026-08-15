import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getWsPrice,
  getWsPrices,
  isWsFeedActive,
  stopWsPriceFeed,
  startWsPriceFeed,
  subscribeSymbols,
} from "./wsPriceFeed.server";

describe("wsPriceFeed (no network — tests pure read API)", () => {
  beforeEach(() => {
    stopWsPriceFeed();
  });
  afterEach(() => {
    stopWsPriceFeed();
  });

  it("returns null for unknown symbols before any data arrives", () => {
    expect(getWsPrice("BTCUSDT")).toBeNull();
  });

  it("exposes an empty map initially", () => {
    expect(getWsPrices()).toEqual({});
  });

  it("is inactive when not started / after stop", () => {
    expect(isWsFeedActive()).toBe(false);
  });

  it("startWsPriceFeed is idempotent and does not throw in Node test env", () => {
    // In a bare Node env the global WebSocket may be undefined — the module
    // must degrade gracefully (start returns without throwing).
    expect(() => startWsPriceFeed()).not.toThrow();
    expect(() => startWsPriceFeed()).not.toThrow(); // second call = no-op
  });

  it("subscribeSymbols does not throw when feed is stopped", () => {
    expect(() => subscribeSymbols(["BTCUSDT", "ETHUSDT"])).not.toThrow();
  });
});
