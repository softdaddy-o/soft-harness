# Removing the YAML dependency

Status: proposal
Goal: delete `yaml` from `dependencies` so `src/` can be shipped inside the
Claude plugin instead of through a separate npm install.

## Why

`package.json` declares exactly one runtime dependency:

```json
"dependencies": { "yaml": "^2.8.3" }
```

Everything else in `src/` (41 files) uses Node built-ins only. That single
dependency is what forces the current two-channel distribution:

| channel | contains | version on this machine |
|---|---|---|
| npm global package | `src/` + `plugins/` | 0.4.39 |
| Claude plugin cache | `skills/` only, no `src/` | 0.4.38 |

The plugin cache is a copied directory; nothing runs `npm install` there, and
Node resolves `require('yaml')` by walking parent directories for a
`node_modules` that does not exist along that path. So `src/` cannot ship in
the plugin while the dependency stands.

The two channels have already drifted (0.4.38 vs 0.4.39) with nothing
reporting it. That drift is the concrete harm; one-channel distribution is the
structural fix.

### Precedent

Official `claude-plugins-official` plugins bundle scripts and keep them
dependency-free:

- `superpowers` — shell scripts, `dependencies: {}`
- `skill-creator` — Python scripts; `utils.py` parses `SKILL.md` frontmatter by
  hand (`---` delimiters, `name:` / `description:` line scan, manual handling of
  the `>`, `|`, `>-`, `|-` indicators) and imports only `pathlib`

Nobody vendors a parser. The dominant pattern is: hand-roll the narrow parse you
actually need.

Correction to an earlier claim in discussion: frontmatter does **not** force a
YAML library. `skill-creator` proves otherwise, and `src/skills.js:1023` already
falls back to its own `parseSimpleFrontmatter` when `YAML.parse` throws.

## Read paths

Every `YAML.parse` call site, classified by who authors the input. This is the
list the design rests on: the dependency only disappears if every foreign read
is covered.

| call site | input | authored by | in plugin runtime? |
|---|---|---|---|
| `settings.js:17` | `.harness/settings/*.yaml` | soft-harness | yes |
| `plugins.js:14` | `.harness/plugins.yaml` | soft-harness | yes |
| `asset-origins.js:13` | `.harness/asset-origins.yaml` | soft-harness | yes |
| `asset-origins.js:47` | `import-origins` input file | **foreign** (JSON tried first) | yes |
| `plugin-origins.js:13` | `.harness/plugin-origins.yaml` | soft-harness | yes |
| `plugin-origins.js:42` | `import-origins` input file | **foreign** (JSON tried first) | yes |
| `skills.js:1018` | `SKILL.md` frontmatter | **foreign** | yes |
| `llm-eval.js:30` | eval `scenario.yaml` | soft-harness | **no** (dev tooling) |

`plugins/soft-harness/skills/*/agents/openai.yaml` is **not** a YAML read path:
`skill-eval.js` loads it with `readRepoFile` as raw text and never parses it.

So there are three foreign inputs, and one dev-only input that never reaches the
plugin. Two of the three have a trivial escape:

`loadAssetOriginsInput` and `loadPluginOriginsInput` already try `JSON.parse`
first and only fall back to YAML:

```js
try {
    const parsed = JSON.parse(text);
    ...
} catch (jsonError) {
    const parsed = YAML.parse(text) || {};
}
```

An earlier draft called dropping that fallback "free". It is not.
`test/plugin-origins.test.js:40` writes an `origins.yaml` fixture and line 51
feeds it straight to `loadPluginOriginsInput`. The CLI takes an arbitrary
`--input=<path>` with no extension constraint, so YAML input is a supported
interface, not an accident. Removing it is a breaking change that needs a
migration error, updated tests, and a version bump — not a silent deletion.

Decision: **keep both inputs working.** These two sites read through
`yaml-lite` like every other `.harness` site. The grammar above already covers
what the fixtures contain.

That leaves `SKILL.md` frontmatter as the only foreign read whose author is
outside this project.

### Is the loop closed?

For the four `.harness/*.yaml` files soft-harness both writes and reads, yes,
with one caveat worth stating rather than averaging away:

- No comment-preservation logic exists anywhere in `settings.js`, `plugins.js`,
  `asset-origins.js`, or `plugin-origins.js`. A rewrite already discards
  comments today.
- The `.harness/*.yaml` files on this machine contain zero `#` comments.

`.harness/` is documented as human-inspectable, so a user *may* hand-edit these
files. The parser must therefore read light hand edits (reordered keys, added
entries, changed indentation within the grammar below) — but it does not have to
preserve comments, because nothing does today.

## Grammar

An explicit whitelist, derived from surveying the real files. A parser with a
documented refusal set is reviewable; one that silently mis-parses is not.

### Accepted

- block mappings, nested by indentation
- block sequences (`- ` items), including sequences of mappings
- nested sequences of scalars under a mapping key
- scalars: bare, single-quoted, double-quoted
- `null` (bare, and empty value), integers, floats, `true` / `false`
- empty flow collections `{}` and `[]`
- **non-empty flow sequences of scalars** — `[shared.js]`,
  `[claude, codex]`. These are not hypothetical: `test/settings.test.js`
  feeds `args: [shared.js]` and `enabled_for: [claude, codex]`,
  `test/plugins.test.js` uses `llms: [claude, codex]`, and origin fixtures use
  `hosts: [claude, codex]`. They are accepted input and committed fixtures, so
  rejecting them is a compatibility break, not a tightening.
- `#` comments and blank lines (skipped, not preserved)

### Rejected — parser throws with the offending line

- anchors and aliases (`&`, `*`)
- tags (`!!str`, etc.)
- block scalars (`|`, `>`, and their chomping variants) — see the scope note
  below: the files that use these never reach the plugin
- multi-document streams (`---` separators)
- non-empty flow **mappings** (`{a: 1}`)
- complex keys (`? `)

Rejecting loudly matters more than covering more syntax, but only for syntax
that is genuinely absent from real input. The accepted list above is derived
from what the repo's own fixtures and tests actually contain, not from what the
writer emits.

## Writer canonicalization

The reader's job is bounded by what the writer emits, so constrain the writer:

- **no line folding.** The current `YAML.stringify` folds long scalars at ~80
  columns, which is why `asset-origins.yaml` contains double-quoted scalars that
  continue across lines. That complexity is library-generated, not inherent.
  Emit one scalar per line.
- stable key order (insertion order of the source object)
- quote a scalar only when it needs quoting: leading/trailing space, a leading
  indicator character, an embedded `:` followed by space, `#`, or when it would
  otherwise parse as a number, boolean, or `null`
- escape `\` and `"` inside double-quoted scalars; never emit a literal newline
  inside a scalar

### Back-compat obligation

Existing `.harness` files already contain two legacy shapes that the current
`YAML.stringify` emits and the reader must therefore accept:

1. **folded double-quoted scalars** — long strings wrapped at ~80 columns
2. **`|-` block scalars** — `YAML.stringify` uses a literal block, not a quoted
   scalar, for any string containing a newline
3. **folded *plain* (unquoted) scalars** — the old writer wraps a long bare
   string the same way it wraps a quoted one:

   ```yaml
   notes: Generated as a Codex skill from Claude plugin skill
     soft-harness@soft-harness.
   ```

The second was missed in an earlier draft. The third was missed by the draft
*and* by review, and only surfaced when the parser was run against the real
`.harness` files on a live machine — `asset-origins.yaml:1021`. Fixture corpora
are necessary but they only contain the shapes someone thought to write down.
Run any replacement parser over real production files before trusting it.

All three are read-only obligations: the new writer emits none of them, but
files already on disk contain them.

Recommendation: **the reader handles both** rather than requiring a rewrite
pass first. It removes any ordering requirement between upgrading and
rewriting, and `|-` is the simpler of the two to consume.

Note this makes `|` a *rejected* construct in new authored input but an
*accepted* one when reading legacy output. State that asymmetry in the parser's
own comments, or the next reader will "simplify" it away.

## Failure mode

`skills.js` currently runs `YAML.parse` as primary with `parseSimpleFrontmatter`
as a lenient fallback. Removing the dependency inverts that shape, so state the
replacement deliberately rather than letting it fall out:

- **`.harness/*.yaml` (soft-harness-authored):** parse strictly. A rejected
  construct throws, naming the file and line. These files are machine-written;
  a construct outside the grammar means either corruption or an unsupported hand
  edit, and both deserve a loud stop rather than a silent partial read.
- **`SKILL.md` frontmatter (foreign):** lenient, but **lossless**. Skills come
  from arbitrary authors and may legitimately use block scalars in
  `description`. A parser that merely skips what it does not understand is
  wrong here: `normalizeSkillMarkdown` copies and re-serializes the *whole*
  parsed frontmatter, so anything the parser drops is silently deleted from the
  author's skill on export. Silent data loss is worse than throwing.

  Requirement: unrecognized frontmatter keys are preserved **byte-for-byte**
  from the source text and re-emitted verbatim. The parser extracts the keys
  soft-harness acts on (`name`, `description`, …) and carries the rest through
  as opaque raw lines. Note the existing `parseSimpleFrontmatter` does *not* do
  this today — it handles neither `>`/`|` continuation nor quoted escapes — so
  this is new work, not a fallback that already exists.

  `src/skills.js:1224` also *writes* frontmatter via `YAML.stringify`. The
  write path is part of this requirement, not just the read path.

## Test strategy

The differential test is the cheapest correctness evidence available and it
expires when the dependency is removed, so it lands first.

1. **Differential, permanent.** For every fixture in the committed corpus,
   assert `yamlLite.parse(text)` deep-equals `YAML.parse(text)`. Scope it to
   **accepted** inputs only: rejected syntax is *supposed* to diverge, so
   "any divergence is a parser bug" is false. Rejected cases get their own
   assertions (3). This suite stays in CI for good, which is why `yaml` is
   demoted rather than deleted.
2. **Round-trip.** `parse → stringify → parse` is stable, and `stringify`
   output re-parses identically under `YAML.parse`.
3. **Rejection.** One case per rejected construct, asserting the thrown error
   names the construct, the file, and the line.
4. **Frontmatter fidelity.** For a corpus of real `SKILL.md` files: `name` and
   `description` match `YAML.parse`, **and** a read→write round-trip preserves
   every unrecognized key byte-for-byte.
5. **Packaging.** Copy the plugin bundle to a temp directory with **no parent
   `node_modules` anywhere above it**, run the CLI's main entry, and assert it
   loads. This is the exact failure being fixed; nothing else proves it.

**Corpus, not "whatever is on this machine."** An earlier draft proposed
differencing against every `.harness/*.yaml` reachable locally. That is not
reproducible and cannot serve as CI evidence. Commit sanitized fixtures under
`test/fixtures/yaml/` covering each supported schema plus each legacy output
shape (folded double-quoted scalars, `|-` blocks emitted by `YAML.stringify`
for strings containing newlines, flow sequences).

## Sequencing

Three commits, not one:

1. add `src/yaml-lite.js` (parse + stringify) and the differential suite, with
   `yaml` still a normal dependency and still in use
2. switch the seven runtime call sites over; the differential suite keeps both
   readers honest
3. move `yaml` from `dependencies` to `devDependencies` and bundle `src/` into
   the plugin

`yaml` is **demoted, not deleted.** That single change resolves three problems
at once:

- `src/llm-eval.js` and `src/skill-eval.js` are required by no `src/` module and
  referenced nowhere in `cli.js` — they are standalone dev tooling driven by
  `scripts/`. They keep using `yaml`, so the block scalars in
  `evals/scenarios/*.yaml` (`user_request: |`) stay out of `yaml-lite`'s scope
  entirely.
- the differential suite keeps its oracle **permanently**, in CI. Deleting the
  oracle right after the migration is how a hand-rolled parser drifts.
- the shipped plugin still carries no runtime dependency, which is the whole
  point.

The plugin bundle must therefore exclude `llm-eval.js` and `skill-eval.js`.
A test asserts that no file reachable from `cli.js` requires `yaml`.

Coupling removal to the parser landing would delete the only oracle available
for verifying the parser.

## Scope

In scope: deleting one dependency so `src/` can ship inside the plugin.

Out of scope, and deliberately not decided here:

- a general YAML implementation
- migrating `.harness/*.yaml` to JSON — a format change with a user-migration
  cost, set aside in discussion and not revisited by this design
- the separate question of making version drift between the two channels
  loud, which is worth doing regardless of whether this proposal proceeds
