# Antigravity Auto-Retry & Recovery Patch

![Antigravity Patcher – Moe Modules in Action](assets/image_moe.png)

A **pure UCBLogo** patcher for the **Antigravity IDE** (VS Code based) that
automates common UI interactions to keep your AI agents running smoothly.

## Why is this useful?
When working with AI agents or long-running tasks in Antigravity, you might
encounter transient network failures, quota limits, or "Running" hangups.
This patch injects a lightweight script that automatically clicks "Retry",
"Allow", and "Run" buttons, and triggers a recovery sequence when the agent
appears stuck.

## Features
- **Auto-Retry**: Automatically clicks "Retry", "Try Again", or "Wiederholen" buttons.
- **Auto-Continue (Recovery Sequence)**: Monitors the "Running…" state.
  If it persists for more than 30 seconds, the patcher automatically:
  1. Clicks **Cancel**.
  2. Waits 3 seconds.
  3. Types **"continue"** into the chat input.
  4. Waits 3 seconds.
  5. Clicks **Send**.
- **Auto-Allow**: Automatically clicks "Allow" buttons.
- **Auto-Run**: Automatically clicks "Run" buttons.
- **Cross-Platform Support**: Works on macOS and Linux.
- **Auto-Detection**: Automatically finds the Antigravity installation path.
- **Safety First**:
  - Automatically creates a backup (`workbench.html.bak`) before making changes.
  - Safely modifies the Content Security Policy (CSP) to allow the injection.
  - Backs up `product.json` to `product.json.bak` and updates its SHA-256
    checksum for `workbench.html` automatically, so Antigravity's integrity
    check does not warn after patching.

## Prerequisites
- **UCBLogo**: On macOS: `brew install ucblogo`.
- **Antigravity IDE**: The IDE must be installed.

## Project Structure

| File | Purpose |
|------|---------|
| `applyAutoRetryContinueAllowPatch.lg` | Entry point — `good bye` |
| `src/locate.lg` | Install location probing (find workbench.html) |
| `src/payload.lg` | Injection script generation (the browser-side IIFE) |
| `src/transform.lg` | HTML transformation (CSP modification, body injection) |
| `src/checksum.lg` | product.json SHA-256 checksum update |
| `src/patch.lg` | Orchestration (write batching, sudo elevation, patch flow) |
| `lib/json.lg` | Pure-Logo JSON parser/serializer (prototypal object system) |
| `lib/lib.lg` | Reusable primitives: word/list utils, Y combinator, SHA-256, hex |
| `lib/sha256.lg` | SHA-256 hash (pure Logo, 32-bit word arithmetic) |
| `lib/base64.lg` | Base64 encoder |
| `docs/PATCHING.md` | Detailed walkthrough of the patching logic |
| `docs/` | Reference implementations (JS, Haskell) and documentation |

## Usage

### 1. Run the patch
```bash
sudo ucblogo applyAutoRetryContinueAllowPatch.lg
```
The patcher auto-detects the Antigravity installation, backs up the
original files, injects the automation script, and updates the
`product.json` checksum — all in one step.

### 2. Restart Antigravity
After the patcher reports success, restart the IDE. The automation logic
will be active in the workbench.

## How it Works
The patcher injects a small JavaScript snippet into `workbench.html`. This
snippet:
1. Runs in the main UI thread.
2. Scans for buttons and monitors state every **100 ms**.
3. Checks for specific button text (case-insensitive) and uses `WeakSet` to
   ensure each button is clicked only once when appropriate.
4. Tracks the duration of the "Running" state to trigger the recovery
   sequence if a timeout is reached.

See [docs/PATCHING.md](docs/PATCHING.md) for a full pseudocode walkthrough.

## Reverting Changes
Use the original JS patcher's reset option, or manually restore from the
`.bak` files:
1. Locate `workbench.html.bak` and `product.json.bak` (under
   `Contents/Resources/app/` on macOS, `resources/app/` on Linux).
2. Replace each patched file with its `.bak` counterpart.

## Implementation Notes
- **No external dependencies** beyond the UCBLogo runtime — no Node.js,
  no `jq`, no `sed`.
- **Pure-Logo JSON** via a prototypal object system (`something` / `kindof` /
  `oneof` / `ask`). Objects are instances with one slot per key; arrays are
  native Logo lists; `null` is a singleton instance.
- **SHA-256 and Base64** are implemented from scratch in Logo for checksum
  computation.
- **Functional style**: stdlib higher-order primitives (`find`, `cascade`,
  `reduce`, `map`, `filter`) before custom recursion; Y combinator only when
  stdlib doesn't fit. Multi-arg calls always parens-wrapped. One-line guards
  (`if pred [output X]`). No `~` line continuations.

## Reference Implementations
The `docs/` directory contains the original JavaScript and Haskell
implementations that this Logo port was derived from, along with the
patching logic walkthrough. They are kept for reference only and are
not required to run the patcher.

## License
Distributed under the **GNU General Public License v3.0**. See `LICENSE` for more information.
