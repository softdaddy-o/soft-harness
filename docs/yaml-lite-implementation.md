# yaml-lite — implementation plan

Companion to `docs/yaml-dependency-removal.md`, which holds the rationale, the
grammar, and the decisions. This file is the build order.

Outcome: `src/` runs with no runtime dependency, so it can be bundled into the
Claude plugin. `yaml` moves to `devDependencies` and stays there as the
differential-test oracle.

## Module

`src/yaml-lite.js`, CommonJS, Node built-ins only, matching the rest of `src/`.

```js
module.exports = { parse, stringify, ParseError };
```

- `parse(text, options)` → plain JS value. `options.filename` is used in errors only.
- `stringify(value)` → canonical text (see Writer below).
- `ParseError extends Error` with `{ filename, line, column, construct }`.

No streaming, no documents API, no schema hooks. If a future caller wants more,
that is a new decision, not an extension to slip in.

## Parse — required behaviour

Derived from the grammar in the design doc. Each bullet gets at least one test.

**Structure**

- block mappings, nested by indentation; indentation is spaces only
- block sequences (`- `), including sequences of mappings and nested sequences
- empty flow collections `{}` and `[]`
- non-empty flow **sequences of scalars**: `[shared.js]`, `[claude, codex]`,
  `[]`. Elements are scalars only; a nested flow collection is rejected

**Scalars**

- bare, single-quoted, double-quoted
- double-quoted escapes: `\\`, `\"`, `\n`, `\t`, `\uXXXX`
- implicit typing, deliberately narrow: `null` / `~` / empty → `null`;
  `true` / `false`; integers; floats. **Everything else stays a string.**
  Do not implement YAML's full implicit-type table — no dates, no sexagesimals,
  no `.inf` / `.nan`, no octal. A date-looking string stays a string, and the
  differential test will catch it if `yaml` disagrees on a fixture that matters.

**Legacy input (read-only)**

- folded double-quoted scalars continuing across lines
- `|-` and `|` literal block scalars

The writer emits neither. They exist only in files already on disk. Say so in a
comment at the top of that branch.

**Hostile input — must not silently succeed**

- duplicate keys in one mapping → `ParseError`. Never last-write-wins.
- tab characters used for indentation → `ParseError`
- a dedent that lands between indentation levels → `ParseError`
- BOM at the start of the file → stripped before parsing
- CRLF → normalized to LF before parsing

**Rejected constructs** — throw `ParseError` naming the construct and line:
anchors/aliases (`&`, `*`), tags (`!!`), multi-document `---`, non-empty flow
mappings (`{a: 1}`), complex keys (`? `), and any block scalar in a file that is
not being read for legacy compatibility.

## Stringify — canonical output

- **no line folding.** One scalar per line, whatever its length. This is what
  makes reading cheap, and it is the single most important writer rule.
- never emit a literal newline inside a scalar: escape it in a double-quoted
  string. The new writer never produces `|-`.
- key order = insertion order of the source object
- quote a scalar only when it must be: leading or trailing whitespace, a leading
  indicator character (`-`, `?`, `:`, `#`, `&`, `*`, `!`, `|`, `>`, `%`, `@`,
  `` ` ``, quotes, brackets, braces), an embedded `: ` or ` #`, an empty string,
  or a value that would otherwise round-trip as `null` / boolean / number
- sequences always block style, one `- ` per line. The writer never emits flow
  style even though the parser accepts it — reading and writing are asymmetric
  here on purpose
- two-space indent, trailing newline, no document marker

Round-trip invariant: `parse(stringify(v))` deep-equals `v` for any value
`stringify` accepts.

## Test corpus

`test/fixtures/yaml/` — committed, sanitized, reproducible. Not "files on this
machine."

| fixture | covers |
|---|---|
| `settings-portable.yaml` | `version`, `mcp_servers: {}`, nested server maps |
| `settings-flow-seq.yaml` | `args: [shared.js]`, `enabled_for: [claude, codex]` |
| `plugins.yaml` | sequence of maps, `llms:` nested scalar sequence |
| `asset-origins.yaml` | `null` values, quoted strings, long `notes` |
| `legacy-folded.yaml` | double-quoted scalar folded across lines |
| `legacy-block.yaml` | `|-` emitted by `YAML.stringify` for a newline string |
| `hostile-duplicate-key.yaml` | duplicate key → throws |
| `hostile-tab-indent.yaml` | tab indentation → throws |
| `rejected-anchor.yaml` | `&a` / `*a` → throws |
| `rejected-flow-map.yaml` | `{a: 1}` → throws |
| `rejected-multidoc.yaml` | second `---` → throws |

Generate `legacy-folded.yaml` and `legacy-block.yaml` with the real `yaml`
package while it is still a dependency, then commit the output. Do not
hand-write them; the point is that they match what the old writer actually
produced.

## Tests

`test/yaml-lite.test.js`

1. **Differential (accepted fixtures only).**
   `assert.deepEqual(yamlLite.parse(t), YAML.parse(t))` for every non-rejected
   fixture. Permanent — this is why `yaml` stays a devDependency.
2. **Round-trip.** `parse → stringify → parse` stable; `YAML.parse` of our
   `stringify` output equals our own `parse` of it.
3. **Rejection.** One test per `rejected-*` and `hostile-*` fixture asserting
   `ParseError` and that the message names file, line, and construct.
4. **Frontmatter fidelity.** For a small corpus of `SKILL.md` samples: `name`
   and `description` match `YAML.parse`, and read → write preserves every
   unrecognized key byte-for-byte.
5. **Packaging.** Copy the plugin bundle to a temp dir with no parent
   `node_modules` above it, run the CLI entry, assert it loads.
6. **Dependency guard.** Walk `require` edges from `src/cli.js` and assert no
   reachable module requires `yaml`. This is what keeps `llm-eval.js` and
   `skill-eval.js` out of the runtime graph as the code changes.

## Call sites

Seven runtime sites move to `yaml-lite`. Two dev-only sites stay on `yaml`.

| file | line | action |
|---|---|---|
| `src/settings.js` | ~17 | `YAML.parse` → `yamlLite.parse` |
| `src/plugins.js` | ~14 | `YAML.parse` → `yamlLite.parse` |
| `src/asset-origins.js` | ~13 | `YAML.parse` → `yamlLite.parse` |
| `src/asset-origins.js` | ~20 | `YAML.stringify` → `yamlLite.stringify` |
| `src/asset-origins.js` | ~47 | `YAML.parse` → `yamlLite.parse` (import input; JSON still tried first) |
| `src/plugin-origins.js` | ~13, ~42 | same as asset-origins |
| `src/plugin-origins.js` | ~20 | `YAML.stringify` → `yamlLite.stringify` |
| `src/skills.js` | ~1018 | frontmatter read → lossless frontmatter reader |
| `src/skills.js` | ~1224 | `YAML.stringify` → frontmatter writer |
| `src/llm-eval.js` | ~30 | **unchanged** — dev tooling, keeps `yaml` |
| `src/skill-eval.js` | — | **unchanged** — reads `openai.yaml` as raw text, never parses |

`src/skills.js` is the only site that needs more than a symbol swap. Its
frontmatter path needs the preserve-unknown-keys behaviour described in the
design doc, and the existing `parseSimpleFrontmatter` fallback is replaced
rather than kept, since strict-primary/lenient-fallback is exactly the shape
being removed.

## Commits

**1 — parser + corpus.** Add `src/yaml-lite.js`, `test/fixtures/yaml/`,
`test/yaml-lite.test.js`. Nothing else changes; `yaml` is still a normal
dependency and still the only parser in use. Full suite green.

**2 — switch runtime call sites.** Move the seven sites. `src/skills.js`
frontmatter work lands here, including its fidelity tests. Differential suite
keeps both readers honest. Full suite green.

**3 — demote and bundle.** `yaml` → `devDependencies`. Exclude `llm-eval.js`
and `skill-eval.js` from the plugin bundle. Add the packaging test and the
dependency guard. Full suite green, plus the packaging test proving the copied
bundle loads with no parent `node_modules`.

Do not collapse these. Commit 1 is worthless without the oracle still present,
and commit 3 is unverifiable without commit 2's differential coverage.

## Out of scope

- migrating `.harness/*.yaml` to JSON
- a general YAML implementation
- changing the eval scenario format
- the separate fix for version drift between the npm package and the plugin
  cache, which is worth doing regardless

## Frontmatter corpus — measured

The open question was whether foreign `SKILL.md` frontmatter needs block scalar
support permanently, or whether `|` is only a legacy `.harness` shim. Measured
across all 54 `SKILL.md` files installed on this machine:

| key | files |
|---|---|
| `name` | 54 |
| `description` | 54 |
| `disable-model-invocation` | 2 |
| `compatibility` | 2 |
| `argument-hint` | 2 |
| `version` | 1 |
| `license` | 1 |

Every one is a flat scalar key/value. Zero block scalars, zero flow sequences,
zero nesting. (The scan was validated by confirming it extracts keys correctly
from sample files first — a silent extraction failure is indistinguishable from
a genuine zero.)

So block scalar reading stays what the design calls it: a legacy shim for
`.harness` files, not a frontmatter requirement.

Caveat: 54 files on one machine is not the ecosystem. `description: |` is a
natural thing for some author to write. The mitigation is already in the design
— unrecognized frontmatter is preserved byte-for-byte rather than parsed — so an
unfamiliar construct survives a round-trip even if the parser does not model it.
Do not use this measurement to justify a parser that *corrupts* what it cannot
read.
