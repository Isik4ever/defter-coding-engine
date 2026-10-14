# Dəftər coding engine

The transaction-coding ladder from [Dəftər](https://github.com/Isik4ever/defter), an on-premise bookkeeping and audit platform for small businesses and accounting firms in Azerbaijan. The full product is private; this is the part that decides *what the agent does when it isn't sure*, extracted as plain TypeScript with its tests.

Built with Claude Code. No cloud, no API keys: the production app runs bge-m3 and Qwen3-4B locally through llama.cpp, and this engine has to work with no model at all.

```
npm install
npm test        # 58 tests, 11 files
```

## The ladder (`router.ts`)

Deterministic first, latent last. Each step only sees what the previous one could not settle.

1. **Rules** (`rules.ts`) – company rules on counterparty, VÖEN, text pattern. Confidence 1.0.
2. **Memory** (`memory.ts`, `hashing.ts`) – kNN over past decisions, direction-aware, with half-life decay on old practice. Accepts at ≥ 0.85.
3. **Classifier** (`bayes.ts`) – naive Bayes on tokens, trained from corrections. Accepts at ≥ 0.6.
4. **LLM** – only consulted when the best candidate is below 0.6, and only if a model is present.

Every suggestion carries `{ account, confidence, source, explanation }`. The explanation (`explain.ts`, `why.ts`) is what the UI shows under "Why?".

## Confidence routing lives in code, not in the prompt

| Band | What happens |
|------|--------------|
| ≥ `auto` (0.90 by default, per company) | Books automatically as a draft, flagged for the morning review. |
| below `auto` | Prefilled proposal, one click to approve or correct. |
| two candidates within **0.15** of each other | The agent does not guess. `clarify.ts` produces one targeted question with 2–4 options, worded from `rules/coding-questions.json`. |

## Corrections are the signal (`corrections.ts`, `activeLearning.ts`)

- Every correction is stored as *expected vs predicted*, with its source.
- A rule corrected **twice** within 90 days is suspended (still suggests, never auto-applies).
- The same counterparty corrected to the same account **three times** proposes a new company rule. A human accepts it.
- `rankForReview` picks the rows a person should look at first: uncertain band, high amount, new counterparty.

## Calibration (`calibration.ts`)

The automation threshold is not a constant. `calibrate()` reads the company's own history in confidence bands (0.5 … 0.95) and returns the lowest band where at least 20 decisions were right at least 95 % of the time. It can only *raise* the configured minimum, never lower it. Automation widens where the evidence says it is safe.

## Evaluation (`evaluate.ts`, `metrics.ts`)

A labelled set runs through the same router; the report splits precision by source (rule / memory / classifier / LLM), reports the auto band on its own and lists the confusions, so a change to one layer cannot hide behind another.

## What is not here

Ledger posting, VAT splitting, bank matching, the SQLite layer and the UI stay in the private repo. Two test files that needed them were left out.

Demo: `docs/demo.mp4` (one minute, no sound) shows the night shift, the inbox with "Why?", document intake and the rules page in the running product.
