# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A pure-UCBLogo patcher for the Antigravity IDE (VS Code based). It injects a JS auto-clicker into `workbench.html` and updates `product.json`'s SHA-256 checksum so the IDE's integrity check passes. **No Node.js, no `jq`, no `sed`** — only `ucblogo` is required at runtime.

The Logo port was derived from `docs/patcher.js` (canonical) and `docs/patcher.hs` (typed reference); both are kept for cross-checking but neither is needed to run anything.

## Reference reading (read before modifying)

Before touching any `.lg` file, **read the UCBLogo manual chapter relevant to your change**, and during coding keep the helpfiles + stdlib source open. The manual + stdlib are the canonical answer for how a primitive behaves; this codebase has already been bitten multiple times by guessing.

```
/usr/local/share/doc/ucblogo/ucblogo.html   -- full manual, prefer over .pdf for grep
/usr/local/share/ucblogo/helpfiles/<name>   -- one-pager per built-in (arity + edge cases)
/usr/local/share/ucblogo/logolib/<name>     -- Logo source for stdlib procedures
```

Concrete workflow:

- **Before adding a custom helper**, grep the helpfiles for an existing one. The "Gotchas" below were all discovered *after* failing to consult the manual first. Existing built-ins worth knowing: `find`, `filter`, `cascade`, `reduce`, `map`, `map.se`, `cond`, `case`, `substringp`, `iseq`, `combine`, `pick`, `remdup`, `remove`, `reverse`.
- **When picking a primitive**, read its helpfile and (if non-trivial) its `logolib/` source. `while`, `ifelse`, `cond`, `case` are *macros* — their `logolib/` source reveals they `run` body lists outside the caller's scope, which is why they can't see object methods inside `ask` blocks. Catching this in helpfile beats catching it via stack overflow.
- **Trust the manual over training data.** The manual chapter on Objects (`#OBJECTS` anchor in the HTML) describes `something` / `kindof` / `oneof` / `ask` / `have` / `havemake` precisely — including that `havemake` is documented but **not shipped in v6.2.5**, which we polyfilled then dropped. Verify primitives are actually present (`definedp`).
- **Re-audit when revisiting old code.** Each pass through the codebase, look for chances to replace custom y-combinator recursion with stdlib equivalents. The codebase's history has several such cleanups (cascade-loops → recursion when heap was bumped; bespoke fold → `reduce`; if-tower → `case`).

## Running

```bash
sudo ucblogo applyAutoRetryContinueAllowPatch.lg     # patch (only mode)
```

The entry trick is `good bye` at the end of the script — `good` runs the orchestration, `bye` quits. The patcher auto-detects the install path; `sudo` is needed to write into `/Applications/Antigravity.app` or `/opt/antigravity`.

To revert: restore `workbench.html.bak` and `product.json.bak` manually (Logo port is patch-only; the `.js` port has reset).

## Verifying changes

There is no test harness — verification is live. The preferred test pattern is **heredoc piped to `ucblogo -`** (read from stdin):

```bash
cat << 'EOF' | ucblogo -
load "lib/json.lg
print (json.serialize 42)
print (json.parse "|{"a":[1,2,3]}|)
bye
EOF
```

Three reasons to prefer this over `ucblogo /tmp/foo.lg`:
- **`ucblogo -` skips the clear-screen escape and welcome banner**, so output is clean and pipeable.
- **Single-quoted `'EOF'`** passes the script body literally — no shell expansion of `$`, backticks, `!`, or `?`. Logo source uses all of those.
- **Stdin EOF cleanly terminates ucblogo**, no SIGPIPE-induced hangs that `... | head` would cause with file invocation.

A common Logo failure mode is a silent stall: an unbalanced `"|...` (or `[...`, `{...`) puts the reader into "waiting for closing delimiter" mode with no error or prompt. Double-check vbar pairing in any heredoc body. If a stall happens, `kill <pid>` the ucblogo process and re-check.

Three checks to run after touching `lib/json.lg`, `src/`, or the entry script:

```bash
# 1. JSON suite (atoms / arrays / objects / parse / round-trip / escapes)
cat << 'EOF' | ucblogo -
load "lib/json.lg
print (json.serialize (json.parse "|{"a":1,"b":[2,3]}|))
make "doc (json.parse "|{"xs":[1,2,3]}|)
ignore (json.set (json.get :doc "xs) 1 99)
print (json.serialize :doc)              ;; expect {"xs":[99,2,3]}
bye
EOF

# 2. product.json round-trip (76 top-level keys must survive)
cat << 'EOF' | ucblogo -
load "lib/json.lg
make "doc (json.parse (file.text "|/Applications/Antigravity.app/Contents/Resources/app/product.json.bak|))
print (json.length :doc)
print (json.get (json.get :doc "checksums) "|vs/code/electron-browser/workbench/workbench.html|)
bye
EOF

# 3. end-to-end patcher
sudo ucblogo applyAutoRetryContinueAllowPatch.lg
LIVE=$(openssl dgst -binary -sha256 \
  /Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html \
  | base64 | tr -d '=')
RECORDED=$(jq -r '.checksums["vs/code/electron-browser/workbench/workbench.html"]' \
  /Applications/Antigravity.app/Contents/Resources/app/product.json)
[[ "$LIVE" == "$RECORDED" ]] && echo MATCH    # must match
```

For multi-iteration probing (comparing N variants), still write to a file once (`cat > /tmp/probe.lg << 'EOF' ... EOF`) and re-invoke — but for one-shot tests, `ucblogo -` keeps the script and its output in the same place.

## Architecture

The patch is one-shot: locate → read clean → transform → queue write → elevate. All writes batch into a single `sudo cp … && sudo cp …` so the user sees one password prompt.

```
applyAutoRetryContinueAllowPatch.lg  (entry: `good bye`)
   loads everything, calls patch.flow

src/locate.lg     -- find.workbench / product.json.path
                     candidate-list probe via (find "filep ...);
                     no per-OS branch (logoplatform can't tell Mac from Linux)

src/payload.lg    -- generate.injection
                     entire JS IIFE as one multi-line vbar word

src/transform.lg  -- patch.html / add.csp.inline / inject.body
                     Y-combinator walkers; pure Logo splice. CSP is scoped
                     to the script-src directive (style-src already has
                     'unsafe-inline'; a global substring check would lie).

src/checksum.lg   -- queue.checksum
                     parse product.json, set the workbench hash, serialize.
                     Uses lib/json.lg (no jq).

src/patch.lg      -- patch.flow / build.cmd / elevate.and.write
                     mutates :writes in the caller's scope (dynamic-scoped),
                     batches all dest/src pairs, single sudo invocation.

lib/json.lg       -- pure-Logo JSON via UCBLogo's prototypal OOP
                     (something / kindof / oneof / ask). objects are
                     instances with one slot per key (mangled "_$key");
                     arrays are native lists (mutated via .setfirst/.setbf);
                     null is a singleton instance.
                     `.setsegmentsize 100000000` at module load -- the
                     default 16k segment is too small for the cons churn.

lib/lib.lg        -- generic primitives. splice.before / splice.after,
                     file.text (byte-exact via readchars), taken / dropn,
                     y combinator, hexn, sh.quote, write.text.

lib/sha256.lg     -- pure-Logo SHA-256, 32-bit-word arithmetic via lib.lg.
lib/base64.lg     -- pure-Logo base64.
```

## UCBLogo gotchas (hard-won)

The Logo we use is v6.2.5 on macOS. Several non-obvious traits shape the code:

**1. Stalls = unbalanced vbar.** A `"|...` without closing `|` puts ucblogo into silent "waiting for closing pipe" mode. No error, no prompt. Looks like a hang. Always pair vbars; when probing via stdin/heredoc, prefer files (`> /tmp/probe.out 2>&1; cat /tmp/probe.out`).

**2. ascii vs rawascii.** Logo's reader stores syntax-special chars (`+ - * / = < > ( ) [ ] { } | ~ ? : ; "` and space/tab) as low-byte sentinels (3-31, excluding 9/10/13). `ascii` decodes back to logical ASCII; `rawascii` returns the raw sentinel. **Always use `ascii`** unless you specifically need the storage byte. File-read words contain raw bytes; vbar-source words contain sentinels — `equalp` distinguishes them, `numberp` only accepts raw bytes (so `parse.number.chars` does `(char (ascii c))` to convert).

**3. Method scoping vs macros.** `while`, `ifelse`, `cond` are *macros* that `run` their body lists outside the current object's scope. Inside `ask :obj [to method ...]`, those macros can't see sibling methods. Workarounds: use direct method recursion (with `.setsegmentsize` heap), or `case` (which works), or hoist into a top-level proc that takes the parser as `:_p`.

**4. `caseignoredp` is a comparator flag, not a storage flag.** Logo's `make` always case-folds variable names internally. JSON keys differing only in case (`userId` vs `userid`) collide on the same slot — last write wins. Documented in `lib/json.lg`'s header.

**5. Slot-name mangling.** `lib/json.lg` prefixes every JSON key with `_$` before using it as a slot name. Without the prefix, a key named `name` collides with `localmake`'s `:name` parameter under `caseignoredp false` and triggers "defined both dynamically and in current object". Method params use `:_k`, `:_v`, `:_src`, etc. for the same reason.

**6. Vbar escapes only honor `\|` and `\\`.** Other `\X` sequences drop the backslash (`\n` → `n`, `\t` → `t`). The whitespace-set in `lib/json.lg`'s `ws.chars` is built via `(char 9)`/`(char 10)`/`(char 13)`, not `"|\t\n\r|`.

## Style guardrails

- Built-ins (`find`, `cascade`, `reduce`, `map`, `filter`, `case`) before custom recursion. Y combinator only when stdlib doesn't fit.
- `(parens)` around every multi-arg call.
- One-line guards: `if pred [output X]`, `if pred [stop]`.
- `;;;;` file headers, `;;;` section, `;;` function docstrings.
- No `~` line continuations.

## Repo conventions

- `*.lg` is highlighted as Logo via `.gitattributes` (linguist override).
- `assets/*.png` are LFS-tracked.
- Script files at the root use a hashbang `#!/usr/bin/env ucblogo` but are not executable in workflow — invoke explicitly via `ucblogo path/to/file.lg`.
