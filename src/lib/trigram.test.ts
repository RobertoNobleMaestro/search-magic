import { describe, expect, it } from "vitest";
import { trigramSimilarity } from "./trigram";

describe("trigramSimilarity", () => {
  it("vale 1 para textos iguales y 0 sin trigramas en común", () => {
    expect(trigramSimilarity("lightning bolt", "lightning bolt")).toBe(1);
    expect(trigramSimilarity("lightning bolt", "xyz")).toBe(0);
    expect(trigramSimilarity("", "rayo")).toBe(0);
  });

  it("tolera erratas como pg_trgm", () => {
    expect(trigramSimilarity("lightnin bolt", "lightning bolt")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("counterspel", "counterspell")).toBeGreaterThan(0.6);
    expect(trigramSimilarity("sol ring", "lightning bolt")).toBeLessThan(0.1);
  });

  it("coincide con pg_trgm en un caso conocido", () => {
    // SELECT similarity('word', 'two words') = 0.36363637 en PostgreSQL
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.363636, 5);
  });
});
