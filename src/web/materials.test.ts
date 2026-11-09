import { expect, it } from "vitest";
import raw from "../../engine/tests/fixtures/deal_toy_inspect.inspect.json";
import { materialsUsed, type InspectRecord } from "./inspect";

const record = raw as unknown as InspectRecord;

it("lists each declared material with its parts and mass, heaviest first", () => {
  const { used, undeclared, total_g } = materialsUsed(record);
  expect(used.map((u) => [u.name, u.parts])).toEqual([
    ["cast acrylic", ["Block"]],
    ["walnut", ["Base"]],
    ["brass", ["Coin"]],
  ]);
  expect(used[2].mass_g).toBeCloseTo(11.54, 2);
  expect(total_g).toBeCloseTo(294.91, 2);
  expect(undeclared).toEqual([]);
});

it("groups parts of one material and reports parts without one", () => {
  const { used, undeclared } = materialsUsed({
    ...record,
    materials: {
      Base: { name: "brass", density_g_cm3: 8.5 },
      Coin: { name: "brass", density_g_cm3: 8.5 },
    },
  });
  expect(used).toHaveLength(1);
  expect(used[0].parts).toEqual(["Base", "Coin"]);
  expect(undeclared).toEqual(["Block"]);
});

it("reports every part as undeclared when a build has no materials", () => {
  const { used, undeclared } = materialsUsed({
    ...record,
    materials: undefined,
  });
  expect(used).toEqual([]);
  expect(undeclared).toEqual(["Base", "Block", "Coin"]);
});
