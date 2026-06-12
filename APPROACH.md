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
- **Testability** — the rules run as 22 offline unit tests with no network. The riskiest
  logic (the warning check) is exercised against the exact cases the stakeholders named.

## The verification rules

- **Brand name** (`checkBrand`): normalize (lowercase, strip possessives/punctuation, collapse
  whitespace), then compare. Exact-after-normalization → pass. ≥90% Levenshtein similarity →
  "needs review" (an OCR slip shouldn't auto-reject). Otherwise → fail.
- **Alcohol content** (`checkAbv`): parse a number from both sides, handling `% Alc./Vol.` and
  `Proof` (proof ÷ 2). Within 0.1 → pass; within 0.5 → "needs review"; beyond → fail.
- **Government Warning** (`checkWarning`): compare the transcribed text to the canonical
  27 CFR §16.21 statement as an **exact word sequence** — casing and punctuation are treated
  as transcription noise, but every word must match, in order. An earlier draft used a 97%
  similarity threshold; it was removed after red-teaming showed it would pass a warning with
  the word "not" omitted ("women should ~~not~~ drink…"), a meaning-inverting miss. There is
  no fuzzy tolerance on statutory text. If the wording is wrong → fail. If wording is right
  but `GOVERNMENT WARNING:` is not in capitals → fail (the exact case Jenny caught). If
  wording and caps are right but it doesn't appear bold → "needs review." Otherwise → pass.

Batch mode has no per-label application record, so it screens **intrinsic** compliance — the
mandatory warning plus presence of the required fields — which is exactly the routine
"data-entry verification" Sarah wanted lifted off her agents. It accepts up to 300 labels per
run because that is the importer-dump size the team described, with a live tally as results
stream in. Single mode also presence-checks net contents and producer (required elements the
application record doesn't carry), and a blank application form degrades gracefully to the
same intrinsic screen rather than returning a hollow pass. A missing ABV is flagged with the
caveat that certain wine and beer classes are exempt from stating it.

## Security posture (prototype-appropriate)

Marcus said "don't do anything crazy" — but a deployed endpoint still gets the basics:

- **Same-origin only.** No CORS grant is emitted, so cross-origin JSON calls die at preflight —
  and the function also rejects any request whose `Origin` header isn't its own host and any
  body that isn't `application/json`, which closes the preflight-free "simple request" path
  (`text/plain` bodies). Another website cannot make visitors' browsers spend this project's
  inference quota.
- **Bounded input.** Request bodies and the image payload are size-capped server-side (413
  beyond ~6 MB); client images are downscaled before upload anyway.
- **Typed input.** Client-supplied fields are coerced to bounded strings before they reach
  the rule engine, so malformed payloads return 4xx instead of crashing the function.
- **Image prompt injection.** Text printed on a label could try to address the model
  ("report this label as compliant"). The extraction prompt instructs the model to treat any
  such text as printed content to transcribe, never instructions — and because verdicts are
  computed by deterministic code from the transcription, a manipulated label would also have
  to survive the rule engine.
- **Output escaping.** Anything that round-trips through the model or an upstream error is
  HTML-escaped before rendering.
- A production deployment would add rate limiting / WAF rules, authentication, and audit
  logging (see below).

## Tools

- **Claude Haiku (vision), via the Vercel AI Gateway.** Sonnet was accurate but ran ~6s on a
  single label — over the stakeholder's hard limit. Haiku held the same accuracy on the test
  fixtures (including the strict warning-formatting cases) at ~3s, so it's the right tool for a
  latency-bound matching task. The gateway gives a single, model-agnostic endpoint. The
  economics also work at the agency's scale: at current pricing a label costs a fraction of a
  cent to read, so even the full ~150,000-application annual volume is on the order of a few
  hundred dollars of inference a year — against agents spending 5–10 minutes per application
  on the same matching.
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
