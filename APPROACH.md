# Approach, tools, and assumptions

## Reading the brief

The take-home is written as discovery notes, so the first job was turning four stakeholder
voices into testable requirements:

| Said in the interview | Turned into a requirement |
|---|---|
| Sarah: "a lot of what we do is just matching" the number on the form to the label | Core flow = verify label fields **against the application**, not free-form analysis |
| Sarah: "If we can't get results back in about 5 seconds, nobody's going to use it" | Hard latency budget. Drove the model choice and the one-label-per-request design |
| Sarah: "something my mother could figure out … half our team is over 50" | One screen, big targets, plain-language verdicts, sample buttons, no hidden controls |
| Sarah / Janet: importers "dump 200, 300 label applications on us at once" | Batch mode with concurrent processing and CSV export |
| Jenny: the warning "has to be **exact** … all caps and bold," caught a title-case one | The warning check is strict and formatting-aware — the highest-value automatable check |
| Dave: `STONE'S THROW` vs `Stone's Throw` "is obviously the same thing. You need judgment" | Brand/ABV matching normalizes case, punctuation, and rounding before comparing |
| Marcus: the firewall "blocked connections to their ML endpoints" | Keep the model call server-side and to a single endpoint (see below) |
| Marcus: "standalone proof-of-concept," not COLA integration; "not storing anything sensitive" | No persistence, no PII handling, no COLA coupling — a clean prototype |

## The central design decision: extract with AI, decide with code

The vision model's only job is to **transcribe** what's printed. Every pass/fail verdict is
plain JavaScript in `lib/ttb-verify-core.mjs`. This matters because:

- **Consistency** — an agent gets the same answer for the same label every time. Asking an
  LLM to "grade" compliance directly would drift run to run and be hard to defend in a
  regulatory setting.
- **Explainability** — each verdict cites the application value and the label value, so an
  agent (and an auditor) can see exactly why.
- **Testability** — the rules run as 16 offline unit tests with no network. The riskiest
  logic (the warning check) is exercised against the exact cases the stakeholders named.

## The verification rules

- **Brand name** (`checkBrand`): normalize (lowercase, strip possessives/punctuation, collapse
  whitespace), then compare. Exact-after-normalization → pass. ≥90% Levenshtein similarity →
  "needs review" (an OCR slip shouldn't auto-reject). Otherwise → fail.
- **Alcohol content** (`checkAbv`): parse a number from both sides, handling `% Alc./Vol.` and
  `Proof` (proof ÷ 2). Within 0.1 → pass; within 0.5 → "needs review"; beyond → fail.
- **Government Warning** (`checkWarning`): compare the transcribed text to the canonical
  27 CFR §16.21 statement (whitespace-normalized, ≥97% to allow trivial punctuation noise).
  If the wording is wrong → fail. If wording is right but `GOVERNMENT WARNING:` is not in
  capitals → fail (this is the exact case Jenny caught). If wording and caps are right but it
  doesn't appear bold → "needs review." Otherwise → pass.

Batch mode has no per-label application record, so it screens **intrinsic** compliance — the
mandatory warning plus presence of the required fields — which is exactly the routine
"data-entry verification" Sarah wanted lifted off her agents.

## Tools

- **Claude Haiku (vision), via the Vercel AI Gateway.** Sonnet was accurate but ran ~6s on a
  single label — over the stakeholder's hard limit. Haiku held the same accuracy on the test
  fixtures (including the strict warning-formatting cases) at ~3s, so it's the right tool for a
  latency-bound matching task. The gateway gives a single, model-agnostic endpoint.
- **Cloudflare Pages + Pages Functions.** Static front-end, one serverless function for the
  model call. No build step, instant deploy, key stays server-side.
- **Vanilla HTML/CSS/JS.** No framework — the UI is deliberately small and the page stays fast
  and obvious, which is the actual requirement here.
- **Node's built-in test runner + Python/Pillow** (sample-label fixtures).

## On the federal network constraint

Marcus's pilot broke because the vendor's client hit scattered ML endpoints from inside the
network. Here the model call is a single server-side HTTPS request to one gateway host — so in
production it sits behind exactly one allow-list entry, and the agent's browser never talks to a
model endpoint at all. If outbound AI calls were disallowed entirely, the same `runChecks` logic
would sit unchanged behind an on-premise OCR/vision service; only the `extractFields` adapter
would change.

## Assumptions

- The applicant's brand name and ABV are available to match against (single mode). In a real
  deployment these come from COLA; here they're entered or pre-filled from a sample.
- "Bold" detection from an image is best-effort, so a correct-but-maybe-not-bold warning is
  flagged as "needs review" rather than auto-failed — a human confirms the typography.
- Scope is a standalone proof-of-concept: no auth, persistence, COLA integration, or PII
  handling, per Marcus's guidance.
- Sample labels are AI-describable fictional labels generated locally (see
  `public/samples/_generate.py`), covering compliant / title-case warning / missing warning /
  ABV-mismatch cases.

## What a production version would add

- Pull the application record straight from COLA and match by serial number.
- A reviewer queue: auto-pass the clean ones, route only "needs review"/"fail" to an agent.
- Confidence scores and a second pass on low-legibility images (de-glare/de-skew) before reject.
- Per-beverage-type rule packs (beer vs wine vs spirits) for class/type and ABV-exemption logic.
- Audit logging of every verdict for defensibility.
