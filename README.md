# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/babes18/csv-reader-speed-01/rank.svg)
![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/babes18/csv-reader-speed-01/reward.svg)

Entry for the make.fun bounty **csv-reader-speed-01-run-20261121**
("Read broken CSV files faster", $100 USDC escrowed, 1st–10th $10 each,
closes Mon 23 Nov 2026 10:42 WITA).

## What it is

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly
what make.fun's own csv-reader 1.0.0 returns for the same `{text, header}`:
`{columns, rows, errors}` — the header (or null), every other record as an
array of strings at the first record's width, and an error record for every
broken thing met (stray CR, quote junk, unterminated quote, short/long row).

`main.ts` is the kit's driver unchanged: it reads every case from
`/input/cases.json`, answers each one alone with `run`, and writes
`/output/answers.json`.

## How it is faster

csv-reader 1.0.0 reads one character at a time and builds every field by
concatenation. This entry reads with `indexOf`/slice and two sticky regexes:

- Lines with no quote and no stray CR are split in bulk (`slice` + `split(',')`).
- The rest are read field by field, one regex exec per field segment instead of
  three `indexOf` calls: `[^,\n\r]*` for unquoted fields, `[^"\n\r]*` for
  quoted fields, and one `["\r]` scan per line for the fast-path check.

Measured locally on the kit's practice set (6 cases, 10.2 MB, Node 24,
`--no-incremental-marking`):

| entry | ms / round | MB/s |
|---|---|---|
| this entry | ~190 | ~54 |
| csv-reader 1.0.0 (house baseline) | ~805 | ~13 |

Fresh-process medians of 7 rounds (above) give about **4.2x faster**; an
interleaved 12-round A/B on the same machine gave 2.3x (mine 218 ms vs
baseline 508 ms). The VM's timing noise is large, but this entry beat the
baseline in every measurement, with byte-identical answers on
all 6 practice cases, 99 hand-written edge cases and 500 fuzzed cases
(compared against the reference with `JSON.stringify`).

## Files

- `solve.js` — the entry (dependency-free ES module).
- `main.ts` — the kit's driver, unchanged.
- `LICENSE` — MIT.

## Build / test

The build and test scripts live outside the repo (the repo must stay under
1 MiB). Locally, from the work directory:

```
node --no-incremental-marking tools/test.mjs --fuzz=500 --timing
```

`tools/test.mjs` checks the practice set, the edge cases and fuzz cases
against the reference, and times both parsers.
