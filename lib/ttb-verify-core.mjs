// TTB label verification — pure logic, no I/O.
// Imported by the Cloudflare Pages Function AND by the Node test suite, so the
// rules that decide pass/fail are exercised the same way in prod and in tests.
//
// Design choice: the AI model only EXTRACTS printed text. Every verdict below is
// deterministic JS — testable, explainable, and stable across runs.

// 27 CFR §16.21 — the exact, legally-mandated Government Warning statement.
export const CANONICAL_WARNING =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink " +
  "alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption " +
  "of alcoholic beverages impairs your ability to drive a car or operate machinery, and may " +
  "cause health problems.";

export function squash(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Aggressive normalization for brand matching: "STONE'S THROW" === "Stone's Throw".
export function normBrand(s) {
  return squash(s).toLowerCase().replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Levenshtein similarity ratio in [0,1].
export function similarity(a, b) {
  a = a || ""; b = b || "";
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  return 1 - d[m][n] / Math.max(m, n);
}

// Pull a percentage out of free text, handling "90 Proof".
export function parseAbv(raw, explicit) {
  if (typeof explicit === "number" && !Number.isNaN(explicit)) return explicit;
  const s = String(raw == null ? "" : raw);
  const pct = s.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) return parseFloat(pct[1]);
  const proof = s.match(/(\d+(?:\.\d+)?)\s*proof/i);
  if (proof) return parseFloat(proof[1]) / 2;
  const bare = s.match(/(\d+(?:\.\d+)?)/);
  return bare ? parseFloat(bare[1]) : null;
}

export function checkBrand(expected, extracted, label = "Brand name") {
  if (!expected) return null;
  const found = squash(extracted);
  if (!found)
    return { field: label, status: "fail", expected, found: "(not detected)",
      detail: `No ${label.toLowerCase()} could be read from the label.` };
  const ne = normBrand(expected), nf = normBrand(found);
  if (ne === nf) {
    const detail = squash(expected) === found ? "Exact match."
      : "Match (ignoring case, punctuation, and spacing).";
    return { field: label, status: "pass", expected, found, detail };
  }
  const ratio = similarity(ne, nf);
  if (ratio >= 0.9)
    return { field: label, status: "warn", expected, found,
      detail: `Near match (${Math.round(ratio * 100)}% similar) — recommend a human glance.` };
  return { field: label, status: "fail", expected, found,
    detail: `Label ${label.toLowerCase()} does not match the application.` };
}

export function checkAbv(expected, extractedRaw, extractedNum) {
  const e = parseAbv(expected, typeof expected === "number" ? expected : undefined);
  if (e == null) return null;
  const f = parseAbv(extractedRaw, extractedNum);
  const foundLabel = squash(extractedRaw) || (f != null ? `${f}%` : "(not detected)");
  if (f == null)
    return { field: "Alcohol content", status: "fail", expected: `${e}% ABV`, found: "(not detected)",
      detail: "No alcohol content could be read from the label." };
  const diff = Math.abs(e - f);
  if (diff <= 0.1)
    return { field: "Alcohol content", status: "pass", expected: `${e}% ABV`, found: foundLabel,
      detail: "Matches the application." };
  if (diff <= 0.5)
    return { field: "Alcohol content", status: "warn", expected: `${e}% ABV`, found: foundLabel,
      detail: `Off by ${diff.toFixed(1)} points — within rounding but worth a check.` };
  return { field: "Alcohol content", status: "fail", expected: `${e}% ABV`, found: foundLabel,
    detail: `Label states ${f}% vs ${e}% on the application.` };
}

// Word sequence for strict comparison: case and punctuation are transcription noise,
// but every WORD must match exactly and in order. A 97%-similarity threshold was
// rejected here on purpose — it would pass a warning with "not" omitted.
export function wordSequence(s) {
  return squash(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).join(" ");
}

// The strict one. Exact statutory wording + "GOVERNMENT WARNING:" in caps and bold.
export function checkWarning(w) {
  w = w || {};
  if (!w.present || !squash(w.verbatim_text))
    return { field: "Government warning", status: "fail", expected: "Required statement present",
      found: "(not found)", detail: "The mandatory Government Warning statement is missing." };
  const found = squash(w.verbatim_text);
  if (wordSequence(found) !== wordSequence(CANONICAL_WARNING))
    return { field: "Government warning", status: "fail", expected: "Exact statutory wording",
      found, detail: "Warning text does not match the required statement word-for-word." };
  if (w.prefix_is_all_caps === false)
    return { field: "Government warning", status: "fail",
      expected: "\"GOVERNMENT WARNING:\" in capitals", found,
      detail: "\"Government Warning\" must appear in capital letters — it is not all-caps here." };
  if (w.appears_bold === false)
    return { field: "Government warning", status: "warn",
      expected: "\"GOVERNMENT WARNING:\" in bold", found,
      detail: "Wording is correct, but the heading may not be bold (TTB requires bold)." };
  return { field: "Government warning", status: "pass",
    expected: "Exact statutory wording, capitalized", found, detail: "Correct wording and formatting." };
}

export function checkPresence(label, value) {
  const found = squash(value);
  return found
    ? { field: label, status: "pass", expected: "Present", found, detail: "Present on label." }
    : { field: label, status: "warn", expected: "Present", found: "(not detected)",
        detail: `${label} not detected — confirm it is on the label.` };
}

// TTB exempts some wine/beer classes from stating alcohol content, so a missing
// ABV is a "confirm against the class" flag, never an auto-reject.
export function checkAbvPresence(extractedRaw, extractedNum) {
  const found = squash(extractedRaw) || (extractedNum != null ? `${extractedNum}%` : "");
  return found
    ? { field: "Alcohol content", status: "pass", expected: "Present", found, detail: "Present on label." }
    : { field: "Alcohol content", status: "warn", expected: "Present (some wine/beer classes exempt)",
        found: "(not detected)",
        detail: "Alcohol content not detected — certain wine and beer classes are exempt; confirm against the class/type." };
}

export function rollup(checks) {
  const c = checks.filter(Boolean);
  if (c.some((x) => x.status === "fail")) return "fail";
  if (c.some((x) => x.status === "warn")) return "warn";
  return "pass";
}

// Run the right set of checks for the mode and return the assembled result.
export function runChecks(mode, application, extracted) {
  const checks = [];
  if (mode === "single") {
    // Match against the application where a value was supplied; otherwise fall back
    // to a presence check so a blank form still yields a meaningful screen instead
    // of a hollow "pass" that only looked at the warning.
    checks.push(squash(application.brandName)
      ? checkBrand(application.brandName, extracted.brand_name)
      : checkPresence("Brand name", extracted.brand_name));
    checks.push(parseAbv(application.abv) != null || typeof application.abv === "number"
      ? checkAbv(application.abv, extracted.alcohol_content, extracted.abv_percent)
      : checkAbvPresence(extracted.alcohol_content, extracted.abv_percent));
    if (application.classType)
      checks.push(checkBrand(application.classType, extracted.class_type, "Class / type"));
    checks.push(checkWarning(extracted.government_warning));
    // Required TTB elements that the application record doesn't carry — verify presence.
    checks.push(checkPresence("Net contents", extracted.net_contents));
    checks.push(checkPresence("Producer name / address", extracted.producer_name_address));
    checks.push(checkOrigin(extracted.country_of_origin));
  } else {
    checks.push(checkWarning(extracted.government_warning));
    checks.push(checkPresence("Brand name", extracted.brand_name));
    checks.push(checkPresence("Class / type", extracted.class_type));
    checks.push(checkAbvPresence(extracted.alcohol_content, extracted.abv_percent));
    checks.push(checkPresence("Net contents", extracted.net_contents));
    checks.push(checkPresence("Producer name / address", extracted.producer_name_address));
    checks.push(checkOrigin(extracted.country_of_origin));
  }
  const cleaned = checks.filter(Boolean);
  return { status: rollup(cleaned), checks: cleaned };
}

// Country of origin is required for IMPORTS only, and import status isn't knowable
// from the label alone (it lives on the COLA application). So: confirm it when
// printed; when absent, return null (no row) rather than wrongly flagging every
// domestic label. Production would key this off the application's import flag.
export function checkOrigin(value) {
  const found = squash(value);
  if (!found) return null;
  return { field: "Country of origin", status: "pass", expected: "Required for imports",
    found, detail: "Present on label (required if this product is imported)." };
}
