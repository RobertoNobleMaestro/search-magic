import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize";

describe("normalizeName", () => {
  it.each([
    ["Lightning Bolt", "lightning bolt"],
    ["  Rayo  ", "rayo"],
    ["Ángel de Serra", "angel de serra"],
    ["Æther Vial", "aether vial"],
    ["Urza's Saga", "urzas saga"],
    ["Urza´s Saga", "urzas saga"],
    ["Urza’s Saga", "urzas saga"],
    ["Fire // Ice", "fire ice"],
    ["Sheoldred, the Apocalypse", "sheoldred the apocalypse"],
    ["Jötun Grunt", "jotun grunt"],
    ["Lim-Dûl's Vault", "lim duls vault"],
    ["Elfos de Llanowar", "elfos de llanowar"],
    ["The Hobbit™", "the hobbit"],
    ["Magic: The Gathering® | Star Trek™", "magic the gathering star trek"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });
});
