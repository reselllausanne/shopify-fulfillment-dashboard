import { describe, expect, it } from "vitest";
import sample from "./__fixtures__/rei-active-lighting-sample.json";
import { classifyReicheltGalaxusKind } from "@/app/lib/reicheltGalaxusCategories";

describe("REI active_component lighting reclass sample", () => {
  it("rescues most lighting titles off Transistor", () => {
    const rows = sample as Array<{ title: string; brand: string }>;
    const counts: Record<string, number> = {};
    const nulls: string[] = [];
    const wrongNet: string[] = [];
    let stillActive = 0;
    for (const row of rows) {
      const kind = classifyReicheltGalaxusKind({ title: row.title }) ?? "null";
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (kind === "active_component") stillActive++;
      if (kind === "null" && nulls.length < 25) nulls.push(`${row.brand}: ${row.title.slice(0, 100)}`);
      if (kind === "network_cable" && wrongNet.length < 10) wrongNet.push(row.title.slice(0, 100));
    }
    console.log(JSON.stringify({ n: rows.length, counts, stillActive, nulls, wrongNet }, null, 2));
    expect(stillActive).toBeLessThan(80); // discrete SMD/wired LEDs stay active_component on purpose
    const lighting =
      (counts.light_bulb ?? 0) +
      (counts.home_lamp ?? 0) +
      (counts.camping_lamp ?? 0) +
      (counts.flashlight ?? 0) +
      (counts.headlamp ?? 0) +
      (counts.motion_sensor ?? 0) +
      (counts.charger ?? 0);
    expect(lighting).toBeGreaterThan(rows.length * 0.5);
    expect(counts.null ?? 0).toBeLessThan(rows.length * 0.2);
  });
});
