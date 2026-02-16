import assert from "assert";
import { parseCsv } from "../app/lib/csv";
import { computeLastRowByKey } from "../app/lib/partnerImport";
import { normalizeSize, parsePriceSafe, stripBom, validateGtin } from "../app/lib/normalize";

function testNormalizeSize() {
  assert.equal(normalizeSize(" EU 40,5 "), "EU40.5");
  assert.equal(normalizeSize(" 40 1/3 "), "401/3");
}

function testParsePriceSafe() {
  assert.equal(parsePriceSafe("106.50"), 106.5);
  assert.equal(parsePriceSafe("106,50"), 106.5);
  assert.equal(parsePriceSafe(" 106,50 CHF "), 106.5);
  assert.equal(parsePriceSafe("1.234,50"), 1234.5);
  assert.equal(parsePriceSafe("-1"), null);
}

function testValidateGtin() {
  assert.equal(validateGtin("12345678"), true);
  assert.equal(validateGtin("123456789012"), true);
  assert.equal(validateGtin("1234567890123"), true);
  assert.equal(validateGtin("12345678901234"), true);
  assert.equal(validateGtin("ABC123"), false);
}

function testStripBomAndDuplicates() {
  const csv = "\uFEFFproviderKey,sku,size,rawStock,price\nAAA,SKU1,42,1,10\nAAA,SKU1,42,2,12\n";
  const rows = parseCsv(csv);
  assert.equal(stripBom(rows[0][0]), "providerKey");
  const headerMap = new Map(rows[0].map((value, index) => [value, index]));
  const lastByKey = computeLastRowByKey(rows, headerMap);
  assert.equal(lastByKey.get("AAA|SKU1|42"), 2);
}

function run() {
  testNormalizeSize();
  testParsePriceSafe();
  testValidateGtin();
  testStripBomAndDuplicates();
  console.log("All tests passed.");
}

run();
