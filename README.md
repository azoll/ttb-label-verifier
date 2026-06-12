# TTB Alcohol Label Compliance Verifier

A working prototype that verifies alcohol beverage labels against the application
and against TTB labeling requirements — in about three seconds per label.

**Live demo:** https://andrewzoll.com/for/us-treasury/
**Built for:** Department of the Treasury — IT Specialist (AI) take-home (announcement `26-DO-12891471-DH`)

---

## What it does

You give it a label image (and, for a single review, the brand name and ABV the
applicant submitted). It:

1. **Reads** the printed fields with a vision model (Claude, via the Vercel AI Gateway).
2. **Verifies** each one with deterministic rules:
   - **Brand name** — matched with judgment. `STONE'S THROW` and `Stone's Throw` pass;
     a one-character OCR slip is a soft "needs review," not a hard fail; a real mismatch fails.
   - **Alcohol content** — parsed (handles `90 Proof`) and compared with a small tolerance.
   - **Government Warning** — the strict one. Held to the exact 27 CFR §16.21 wording,
     with `GOVERNMENT WARNING:` in capital letters and bold. The comparison is an exact
     word-sequence match (only punctuation/casing transcription noise is forgiven), so a
     warning with even one word omitted or substituted — e.g. dropping the word "not" —
     fails. Title-case, reworded, or missing = rejected.
   - **Net contents & producer name/address** — presence-verified on every label
     (TTB-required elements). A missing ABV is flagged with a note that certain wine and
     beer classes are exempt.
3. **Returns** a plain pass / needs-review / fail per field, with the exact reason.

Two modes:

- **Verify one label** — match a label against a specific application record.
- **Batch screen** — sized for the 200–300-label importer dumps the compliance team
  described: drop up to 300 labels at once. Each is screened for the mandatory warning and
  the required fields; results stream in concurrently with a live pass/review/fail tally
  and export to CSV. Leaving the application fields blank in single mode runs the same
  intrinsic screen on one label.

## Architecture

```
Browser (public/index.html)
  │  downsizes the image, POSTs JSON  →  /verify
  ▼
Cloudflare Pages Function (functions/verify.js)
  │  one HTTPS call, server-side      →  Vercel AI Gateway  →  Claude (Haiku) vision
  │  receives extracted fields
  ▼
Deterministic rules (lib/ttb-verify-core.mjs)  →  pass / warn / fail JSON
```

- **The model only extracts text. The code decides pass/fail.** Verdicts are therefore
  explainable and identical across runs — see `lib/ttb-verify-core.mjs`, which is unit-tested.
- **One label per request**, so each verification stays under the 5-second bar and a
  batch fans out concurrently instead of queueing.
- The API key lives only in a server-side environment binding; it never reaches the browser.
- The endpoint is same-origin only (no CORS), request bodies are size-capped, client input is
  type-coerced, model errors are escaped before rendering, and the extraction prompt is
  hardened against instruction-like text printed on a label (image prompt injection).

## Run it locally

Requires Node 18+ and a [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) key
(`vck_…`) that can route to `anthropic/*` models.

```bash
npm install
cp .dev.vars.example .dev.vars     # then paste your AI_GATEWAY_API_KEY
npm run dev                        # wrangler serves the app + function at http://localhost:8788
```

Open http://localhost:8788/ and click a sample label, or drop your own.

### Tests

```bash
npm test        # 22 offline unit tests of the verdict logic — no network
```

### Regenerate the sample labels

```bash
npm run samples # writes the four fixtures in public/samples/ (needs Python + Pillow)
```

## Deliverables map

| Requirement | Where |
|---|---|
| Reads brand, class/type, ABV, net contents, producer, warning | `functions/verify.js` (extraction prompt) |
| Brand & ABV matched with tolerance | `lib/ttb-verify-core.mjs` → `checkBrand`, `checkAbv` |
| Government Warning held to exact wording + caps | `lib/ttb-verify-core.mjs` → `checkWarning` |
| Under ~5 seconds | Haiku model + per-label requests (~3s observed) |
| Batch upload | `public/index.html` → Batch tab + concurrency pool |
| Simple, obvious UI | `public/index.html` |
| Deployed prototype | https://andrewzoll.com/for/us-treasury/ |

## Notes, assumptions, and trade-offs

See **[APPROACH.md](./APPROACH.md)** for how the stakeholder interviews were turned into
requirements, why each technical choice was made, the federal-network consideration, and
what a production build would add.

## Disclaimer

A prototype built independently for an interview take-home. Not affiliated with or endorsed
by the U.S. Department of the Treasury or TTB. The sample labels are fictional.
