import { describe, expect, it } from "vitest";
import { parseVenovaPageShipping } from "@/app/lib/venovaClient";

const SMALL_WIDGET = `
<div class="fz_shipping"> <table>
<tr><td><span class="fz_dispatch_name">PostPac Economy</span></td>
<td class="fz_shipping_value"> 10,00 CHF </td></tr>
<tr><td><span class="fz_dispatch_name">PostPac Priority</span></td>
<td class="fz_shipping_value"> 12,00 CHF </td></tr>
</table> </div>
`;

const WASHER_WIDGET = `
<div class="fz_shipping"> <table>
<tr><th>Spezialversand</th><th>Kosten</th></tr>
<tr><td><span class="fz_dispatch_name">Stückgut (Kurier)</span></td>
<td class="fz_shipping_value"> 92,00 CHF </td></tr>
</table> </div>
`;

describe("parseVenovaPageShipping", () => {
  it("prefers PostPac Economy on small PDPs", () => {
    expect(parseVenovaPageShipping(SMALL_WIDGET)).toEqual({
      method: "PostPac Economy",
      shippingChf: 10,
      kind: "postpac_economy",
    });
  });

  it("reads Stückgut mega-item quote (e.g. CHF 92 washer)", () => {
    expect(parseVenovaPageShipping(WASHER_WIDGET)).toEqual({
      method: "Stückgut (Kurier)",
      shippingChf: 92,
      kind: "stueckgut",
    });
  });
});
