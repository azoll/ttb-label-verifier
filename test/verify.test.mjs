// Offline unit tests for the verdict logic. No network — feed the checker
// mock "extracted" objects (what the vision model would return) and assert the
// verdicts. Run: `npm test`  (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_WARNING, normBrand, parseAbv, similarity,
  checkBrand, checkAbv, checkWarning, checkPresence, runChecks,
} from "../lib/ttb-verify-core.mjs";

const goodWarning = {
  present: true, verbatim_text: CANONICAL_WARNING,
  prefix_is_all_caps: true, appears_bold: true,
};

test("normBrand collapses case, possessives, spacing", () => {
  assert.equal(normBrand("STONE'S THROW"), normBrand("Stone’s Throw"));
  assert.equal(normBrand("Old  Tom   Distillery"), "old tom distillery");
});

test("parseAbv reads %, proof, and bare numbers", () => {
  assert.equal(parseAbv("45% Alc./Vol. (90 Proof)"), 45);
  assert.equal(parseAbv("90 Proof"), 45);
  assert.equal(parseAbv("13.5"), 13.5);
  assert.equal(parseAbv("no alcohol text"), null);
});

test("brand: exact and normalized matches pass", () => {
  assert.equal(checkBrand("Old Tom Distillery", "OLD TOM DISTILLERY").status, "pass");
  assert.equal(checkBrand("Stone's Throw", "Stone’s Throw").status, "pass");
});

test("brand: a real mismatch fails", () => {
  assert.equal(checkBrand("Old Tom Distillery", "River Bend Reserve").status, "fail");
});

test("brand: a one-character OCR slip is a soft warn, not a hard fail", () => {
  const r = checkBrand("Old Tom Distillery", "Old Ton Distillery");
  assert.equal(r.status, "warn");
});

test("abv: exact passes, proof-derived passes, real gap fails", () => {
  assert.equal(checkAbv("45%", "45% Alc./Vol. (90 Proof)", 45).status, "pass");
  assert.equal(checkAbv(45, "90 Proof", null).status, "pass");
  assert.equal(checkAbv("12.5%", "13.5% Alc./Vol.", 13.5).status, "fail");
});

test("warning: correct wording + caps + bold passes", () => {
  assert.equal(checkWarning(goodWarning).status, "pass");
});

test("warning: title-case prefix fails (the Jenny case)", () => {
  const r = checkWarning({ ...goodWarning,
    verbatim_text: "Government Warning:" + CANONICAL_WARNING.slice("GOVERNMENT WARNING:".length),
    prefix_is_all_caps: false });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /capital letters/);
});

test("warning: reworded text fails even if capitalized", () => {
  const r = checkWarning({ present: true, prefix_is_all_caps: true, appears_bold: true,
    verbatim_text: "GOVERNMENT WARNING: Drinking is bad for you and may cause problems." });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /word-for-word/);
});

test("warning: missing statement fails", () => {
  assert.equal(checkWarning({ present: false, verbatim_text: null }).status, "fail");
});

test("warning: correct wording but not bold is a warn", () => {
  assert.equal(checkWarning({ ...goodWarning, appears_bold: false }).status, "warn");
});

test("presence check warns when a required field is absent", () => {
  assert.equal(checkPresence("Net contents", "").status, "warn");
  assert.equal(checkPresence("Net contents", "750 mL").status, "pass");
});

test("runChecks single: fully compliant label passes overall", () => {
  const extracted = {
    brand_name: "OLD TOM DISTILLERY", class_type: "Kentucky Straight Bourbon Whiskey",
    alcohol_content: "45% Alc./Vol. (90 Proof)", abv_percent: 45, net_contents: "750 mL",
    producer_name_address: "Bardstown, KY", government_warning: goodWarning,
  };
  const r = runChecks("single", { brandName: "Old Tom Distillery", abv: "45%" }, extracted);
  assert.equal(r.status, "pass");
});

test("runChecks single: one bad field fails the whole label", () => {
  const extracted = {
    brand_name: "OLD TOM DISTILLERY", alcohol_content: "45%", abv_percent: 45,
    government_warning: { present: false },
  };
  const r = runChecks("single", { brandName: "Old Tom Distillery", abv: "45%" }, extracted);
  assert.equal(r.status, "fail");
});

test("runChecks batch: screens intrinsic compliance without application data", () => {
  const extracted = {
    brand_name: "X", class_type: "Y", alcohol_content: "40%", net_contents: "750 mL",
    producer_name_address: "Z", government_warning: goodWarning,
  };
  const r = runChecks("batch", {}, extracted);
  assert.equal(r.status, "pass");
  assert.ok(r.checks.find((c) => c.field === "Government warning"));
});

test("similarity is 1 for identical and <1 for different strings", () => {
  assert.equal(similarity("abc", "abc"), 1);
  assert.ok(similarity("abc", "abd") < 1);
});
