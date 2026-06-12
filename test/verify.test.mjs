// Offline unit tests for the verdict logic. No network — feed the checker
// mock "extracted" objects (what the vision model would return) and assert the
// verdicts. Run: `npm test`  (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_WARNING, normBrand, parseAbv, similarity,
  checkBrand, checkAbv, checkWarning, checkPresence, checkAbvPresence, checkOrigin, runChecks,
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

test("warning: omitting a single word ('not') fails — no similarity loophole", () => {
  const r = checkWarning({ present: true, prefix_is_all_caps: true, appears_bold: true,
    verbatim_text: CANONICAL_WARNING.replace("should not drink", "should drink") });
  assert.equal(r.status, "fail");
  assert.match(r.detail, /word-for-word/);
});

test("warning: substituting one word fails — no similarity loophole", () => {
  const r = checkWarning({ present: true, prefix_is_all_caps: true, appears_bold: true,
    verbatim_text: CANONICAL_WARNING.replace("birth defects", "birth issues") });
  assert.equal(r.status, "fail");
});

test("warning: punctuation/casing transcription noise still passes", () => {
  const noisy = CANONICAL_WARNING.replace("(1)", "(1) ").replace("machinery,", "machinery ,");
  const r = checkWarning({ present: true, prefix_is_all_caps: true, appears_bold: true,
    verbatim_text: noisy });
  assert.equal(r.status, "pass");
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

test("abv presence: missing ABV warns with the wine/beer exemption note", () => {
  const r = checkAbvPresence(null, null);
  assert.equal(r.status, "warn");
  assert.match(r.detail, /exempt/);
});

test("runChecks single: blank application falls back to an intrinsic screen", () => {
  const extracted = {
    brand_name: "OLD TOM DISTILLERY", class_type: "Bourbon",
    alcohol_content: "45%", abv_percent: 45, net_contents: "750 mL",
    producer_name_address: "Bardstown, KY", government_warning: goodWarning,
  };
  const r = runChecks("single", { brandName: "", abv: "", classType: "" }, extracted);
  assert.equal(r.status, "pass");
  // presence fallbacks ran instead of silent skips
  assert.ok(r.checks.find((c) => c.field === "Brand name"));
  assert.ok(r.checks.find((c) => c.field === "Alcohol content"));
  assert.ok(r.checks.find((c) => c.field === "Net contents"));
});

test("runChecks single: includes net contents + producer presence (TTB-required fields)", () => {
  const extracted = {
    brand_name: "OLD TOM DISTILLERY", alcohol_content: "45%", abv_percent: 45,
    net_contents: null, producer_name_address: null, government_warning: goodWarning,
  };
  const r = runChecks("single", { brandName: "Old Tom Distillery", abv: "45%" }, extracted);
  assert.equal(r.status, "warn");
  assert.equal(r.checks.find((c) => c.field === "Net contents").status, "warn");
});

test("origin: shown as confirmation when printed, no false flag when absent", () => {
  assert.equal(checkOrigin("Product of USA").status, "pass");
  assert.equal(checkOrigin(null), null); // domestic labels aren't wrongly flagged
});

test("runChecks surfaces country of origin in both modes when present", () => {
  const extracted = {
    brand_name: "X", class_type: "Y", alcohol_content: "40%", abv_percent: 40,
    net_contents: "750 mL", producer_name_address: "Z", country_of_origin: "Product of France",
    government_warning: goodWarning,
  };
  for (const mode of ["single", "batch"]) {
    const r = runChecks(mode, { brandName: "X", abv: "40%" }, extracted);
    assert.ok(r.checks.find((c) => c.field === "Country of origin"), mode);
  }
});
