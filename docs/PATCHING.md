# Patching Logic (Pseudocode)

Host-side walkthrough of the pure-Logo `applyAutoRetryContinueAllowPatch.lg`
patcher. The browser-side code produced by `generateInjectionScript()` is
intentionally left out — read it directly in the source.

Reference implementations in JavaScript and Haskell are kept in `docs/`
for historical context.

## Entry point

```
MAIN:
    mode = prompt_menu()            # 1..9 → all | retry | allow | run | continue | combos | reset_all
    wb   = find_workbench_html()    # platform-specific install-path probe
    if !wb: fail "Antigravity not installed"

    bak      = wb + ".bak"
    prod     = resolve(dirname(wb), "../../../../../product.json")   # 5 dirs up to <app>/
    prod_bak = prod + ".bak"

    try:
        if mode == reset_all: RESET(wb, bak, prod, prod_bak)
        else:                 PATCH(mode, wb, bak, prod, prod_bak)
    catch err:
        if err.code == EACCES: print "run as admin/sudo"
        else:                  print err.message
        exitCode = 1
```

## Reset flow

```
RESET(wb, bak, prod, prod_bak):
    require bak exists, else abort "nothing to reset"

    restored = read(bak)
    writes   = [ wb ← restored ]

    if prod_bak exists:
        writes += [ prod ← read(prod_bak) ]
    else:
        # Patch predates product.json backup support. Recompute checksum so
        # Antigravity's integrity check doesn't warn after the reset.
        QUEUE_CHECKSUM(writes, prod, restored, "Recomputing")

    WRITE_ELEVATED(writes)
```

## Patch flow

```
PATCH(mode, wb, bak, prod, prod_bak):
    # 1. clean base — never double-patch
    if bak exists:
        clean = read(bak)
    else:
        clean = read(wb)
        if clean contains patch-marker:
            abort — file is already patched but has no backup to roll back to
        try write(bak, clean); on EACCES defer the backup write to step 5

    # 2. build the injection
    script = generateInjectionScript(mode)
    html   = add "'unsafe-inline'" to script-src CSP    # else injected <script> is blocked
    html   = insert script before </body>               # fallback: after <body>, else append

    # 3. queue the workbench writes
    writes = [ wb ← html ]
    if bak not on disk yet:
        writes += [ bak ← clean ]

    # 4. product.json — first-patch snapshot + checksum refresh
    if prod exists && !prod_bak:
        writes += [ prod_bak ← read(prod) ]
    QUEUE_CHECKSUM(writes, prod, html, "Updating")

    # 5. commit (single sudo prompt for the whole batch)
    WRITE_ELEVATED(writes)
```

## Helpers

### `QUEUE_CHECKSUM`

Keeps `product.json`'s SHA-256 entry for `workbench.html` in sync with whatever
bytes we're about to write. No-op if the file / entry is absent, or already matches.

```
QUEUE_CHECKSUM(writes, prod, html_buf, verb):
    if !exists(prod):                     warn, return
    p = parse(read(prod))
    if !p.checksums[workbench_key]:       warn, return    # nothing to update
    new = sha256_base64_no_padding(html_buf)
    if new == p.checksums[workbench_key]: return          # already correct
    p.checksums[workbench_key] = new
    writes += [ prod ← stringify(p, tab-indented) ]
```

### `WRITE_ELEVATED`

Batches writes so the user sees at most one sudo prompt per run.

```
WRITE_ELEVATED(writes):
    if already elevated:
        write each file directly; done

    if win32 (not admin):
        fail "run terminal as Administrator"

    else (linux/macos, not root):
        for each write: spill to /tmp/antigravity-patch-<PID>-<i>-<basename>
        run: sudo cp TMP DEST && sudo cp TMP DEST && ...   # shell-quoted; one sudo prompt
        unlink all temp files (finally — even on error)
```

### `find_workbench_html`

```
find_workbench_html():
    rel = resources/app/out/vs/code/electron-browser/workbench/workbench.html
    candidates = by platform:
        linux:  /usr/share/antigravity/<rel>
                /opt/antigravity/<rel>
        win32:  %LOCALAPPDATA%/Programs/Antigravity/<rel>
                %ProgramFiles%/Antigravity/<rel>
                %ProgramFiles(x86)%/Antigravity/<rel>
        darwin: /Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-browser/workbench/workbench.html
    return the first candidate that exists, else null
```

## Invariants

- The `.bak` files are the single source of truth for "what clean looks like".
  Once written they're never overwritten — both patch and reset read from them.
- Patching is idempotent: re-running with a different mode rebuilds from `bak`,
  not from the already-patched `workbench.html`.
- Every elevation batches all writes into one `sudo cp … && sudo cp …`
  invocation, so there's only one password prompt per run.
- `product.json`'s checksum entry is only *updated*, never *added* — if the
  installation has no pre-existing checksum for workbench.html, we leave it alone.


### `generateInjectionScript`

Builds an HTML `<script>` block as a string. Which sections are emitted
depends on the mode flags; the pseudocode below shows the **emitted IIFE**,
not the string-building machinery. Sections marked `[retry]`, `[allow]`,
`[run]`, `[continue]` are only present when the corresponding flag is on.

```
generateInjectionScript(mode):
    flags = {
        retry:    mode == "all" || "retry"    in mode,
        continue: mode == "all" || "continue" in mode,
        allow:    mode == "all" || "allow"    in mode,
        run:      mode == "all" || "run"      in mode,
    }
    return <script>-wrapped IIFE with sections below gated by `flags`
```

Emitted IIFE (runs in the workbench window, once, at load):

```
(function() {
    const clickedButtons = new WeakSet()   # one-click-only guard across ticks

    # Word-boundary regexes — avoid Truncate/Resend/Disallow/Rerun false-positives.
    const RETRY_RE  = /\b(retry|try\s+again|wiederholen)\b/i
    const ALLOW_RE  = /\ballow\b/i
    const RUN_RE    = /\brun\b/i
    const CANCEL_RE = /\bcancel\b/i
    const SEND_RE   = /\bsend\b/i
    const CLICKABLE_SELECTOR = 'button, a.monaco-button, div.monaco-button'

    buttonText(el):   return el.aria-label || el.title || el.textContent || ''
    matches(el, re):  return re.test(buttonText(el))
    findAnyButton(re):
        for el in document.querySelectorAll(CLICKABLE_SELECTOR):
            if matches(el, re): return el
        return null

    [retry|allow|run]                      # emitted if any of the three is enabled
    findFreshEnabledButton(re, buttons):
        for el in buttons:
            if el.disabled or clickedButtons.has(el): continue
            if matches(el, re): return el
        return null

    [continue]                             # emitted only if `continue` is enabled
    let runningCounter     = 0
    let hasSeenDots        = false
    let isHandlingSequence = false
    let lastRecoveryAt     = 0
    const RECOVERY_COOLDOWN_MS = 60_000

    setInputValue(selector, value):
        input = document.querySelector(selector)
        if !input: return false
        input.focus()
        input.value = value
        dispatch 'input' and 'change' events (bubbles: true)
        return true

    async executeRecoverySequence():       # re-entry-guarded, invoked from tick()
        if isHandlingSequence: return
        isHandlingSequence = true
        lastRecoveryAt     = Date.now()
        try:
            cancel = findAnyButton(CANCEL_RE)
            if !cancel:
                # "Running" text came from chat history, not an active task
                log "skipping recovery (likely false positive)"
                return
            cancel.click()
            await sleep(3000)
            setInputValue(
                'textarea[placeholder*="Ask anything" i], input[placeholder*="Ask anything" i]',
                'continue')
            await sleep(3000)
            send = findAnyButton(SEND_RE)
            if send: send.click()
        catch e: console.error(e)
        finally:
            runningCounter     = 0
            hasSeenDots        = false
            isHandlingSequence = false

    tick():
        try:
            [retry|allow|run]
            buttons = document.querySelectorAll('button, a.monaco-button')

            [retry]
            r = findFreshEnabledButton(RETRY_RE, buttons)
            if r: clickedButtons.add(r); r.click()

            [allow]
            a = findFreshEnabledButton(ALLOW_RE, buttons)
            if a: clickedButtons.add(a); a.click()

            [run]
            u = findFreshEnabledButton(RUN_RE, buttons)
            if u: clickedButtons.add(u); u.click()

            [continue]
            if !isHandlingSequence:
                body     = document.body.innerText || ''
                hasDots  = /Running\.{1,3}/.test(body)   # animated dots
                hasPlain = body.includes('Running')
                if hasDots: hasSeenDots = true
                if hasDots || (hasSeenDots && hasPlain):
                    runningCounter++
                    if runningCounter >= 300:            # 30 s at 100 ms cadence
                        if Date.now() - lastRecoveryAt < RECOVERY_COOLDOWN_MS:
                            # still in cooldown: stop re-triggering every tick
                            runningCounter = 0
                            hasSeenDots    = false
                        else:
                            executeRecoverySequence()
                else:
                    runningCounter = 0
                    hasSeenDots    = false
        catch e: console.error(e)

    setInterval(tick, 100)                 # 100 ms cadence, forever
})()
```

Notes on the injected loop:

- `clickedButtons` is a `WeakSet`: a DOM node is clicked at most once per page
  lifetime. When Antigravity replaces the node (common after a click), the new
  node is eligible again — no reference leak, no stale state.
- Matching uses `aria-label` first, then `title`, then `textContent`. This
  order intentionally prefers the accessible label over visible text.
- The `continue` recovery has three guards against spurious firing: the
  `Running...` dotted regex (not just the word), the Cancel-button presence
  check, and the 60 s cooldown after each attempt.

## Implementation notes (`applyAutoRetryContinueAllowPatch.lg`)

The patcher is pure Logo — no external dependencies beyond the UCBLogo
runtime (Mac/Linux). Notable design choices:

- **No platform switch.** `(find "filep (wb.candidates))` returns the first
  existing path from a candidate list. Mac path is checked first; on Linux
  it falls back to `/usr/share/antigravity/...` then `/opt/antigravity/...`.
  `logoplatform` returns `Unix-Nographics` on both Mac and Linux, so we
  probe instead of branching.
- **`product.json` path is derived**, not hard-coded — strip the well-known
  suffix from the workbench path, append `product.json`. Same suffix on
  Mac (`Resources/app/...`) and Linux (`resources/app/...`).
- **No `sed` shellout.** HTML splice is `splice.before :hay :needle :insert`
  (in `lib/lib.lg`), a y-combinator walker. The same primitive does the body
  injection. The CSP edit uses a scope-aware walker — finds `script-src`,
  then inserts `'unsafe-inline'` just before that directive's terminating
  `;` if the directive segment doesn't already include it. (A global
  `'unsafe-inline'` substring check would falsely match `style-src`'s.)
- **Pure-Logo JSON edits via `lib/json.lg`.** A small library built on
  UCBLogo's prototypal object system (`something` / `kindof` / `oneof` /
  `ask`). JSON objects are instances of `:json.object` with one slot per
  key; arrays are native Logo lists (`.setfirst` / `.setbf` make nested
  mutation work without a wrapper class); `null` is a singleton instance.
  The parser is itself a stateful object (`:json.parser`). See `lib/json.lg`
  for the full design notes.
- **Mode is `"all"` only** today. The `:mode` parameter is reserved for
  future per-feature gating.
- **Reset flow** is not implemented. Restore from `.bak` files manually.

Style notes shared across `.lg` modules: stdlib higher-order primitives
(`find`, `cascade`, `reduce`, `map`, `filter`) before custom recursion;
y-combinator only when stdlib doesn't fit. Multi-arg calls always
parens-wrapped. One-line guards (`if pred [output X]`). No `~` line
continuations.
