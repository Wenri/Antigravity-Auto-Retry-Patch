const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const readline = require('readline');

const CHECKSUM_KEY = 'vs/code/electron-browser/workbench/workbench.html';

function computeChecksum(buf) {
    return crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
}

function getProductJsonPath(workbenchPath) {
    // workbench.html lives at <app>/out/vs/code/electron-browser/workbench/workbench.html
    // product.json lives at   <app>/product.json  — 5 directories up.
    return path.resolve(path.dirname(workbenchPath), '..', '..', '..', '..', '..', 'product.json');
}

/**
 * Antigravity Auto-Retry Patch Utility
 * This script injects a small JavaScript snippet into the Antigravity workbench
 * to automatically click "Retry" buttons and/or fix "Running" hangups.
 */

function log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[\x1b[32m${timestamp}\x1b[0m] [INFO] ${message}`);
}

function warn(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.warn(`[\x1b[33m${timestamp}\x1b[0m] [WARN] ${message}`);
}

function error(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.error(`[\x1b[31m${timestamp}\x1b[0m] [ERROR] ${message}`);
}

/**
 * Generates the injection script based on the user's choice.
 */
function generateInjectionScript(choice) {
    const includeRetry = choice === 'all' || choice.includes('retry');
    const includeContinue = choice === 'all' || choice.includes('continue');
    const includeAllow = choice === 'all' || choice.includes('allow');
    const includeRun = choice === 'all' || choice.includes('run');

    return `
<!-- Antigravity Auto-Retry Patch Start -->
<script type="text/javascript">
(function() {
    console.log("Antigravity Auto-Retry: Direct Injection successful.");
    const clickedButtons = new WeakSet();

    // Word-boundary match — avoids "Truncate" matching "run",
    // "Resend" matching "send", "disallow" matching "allow", etc.
    const RETRY_RE  = /\\b(?:retry|try\\s+again|wiederholen)\\b/i;
    const ALLOW_RE  = /\\ballow\\b/i;
    const RUN_RE    = /\\brun\\b/i;
    const CANCEL_RE = /\\bcancel\\b/i;
    const SEND_RE   = /\\bsend\\b/i;

    const CLICKABLE_SELECTOR = 'button, a.monaco-button, div.monaco-button';

    function buttonText(el) {
        return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '');
    }
    function matches(el, re) {
        return re.test(buttonText(el));
    }
    function findAnyButton(re) {
        for (const el of document.querySelectorAll(CLICKABLE_SELECTOR)) {
            if (matches(el, re)) return el;
        }
        return null;
    }
    ${(includeRetry || includeAllow || includeRun) ? `
    function findFreshEnabledButton(re, buttons) {
        for (const el of buttons) {
            if (el.disabled) continue;
            if (clickedButtons.has(el)) continue;
            if (matches(el, re)) return el;
        }
        return null;
    }
    ` : ''}

    ${includeContinue ? `
    let runningCounter = 0;
    let hasSeenDots = false;
    let isHandlingSequence = false;
    let lastRecoveryAt = 0;
    const RECOVERY_COOLDOWN_MS = 60000;

    function setInputValue(selector, value) {
        const input = document.querySelector(selector);
        if (!input) return false;
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    async function executeRecoverySequence() {
        if (isHandlingSequence) return;
        isHandlingSequence = true;
        lastRecoveryAt = Date.now();
        console.log('Antigravity Auto-Retry: "Running" state detected for > 30s. Executing recovery...');
        try {
            const cancelButton = findAnyButton(CANCEL_RE);
            if (!cancelButton) {
                // No Cancel button visible — the "Running" match is almost
                // certainly stale text in chat history, not an active task.
                // Skip the rest to avoid spuriously sending "continue".
                console.log('Antigravity Auto-Retry: No Cancel button found; skipping recovery (likely false positive).');
                return;
            }
            console.log('Antigravity Auto-Retry: Clicking Cancel button.');
            cancelButton.click();

            await new Promise(r => setTimeout(r, 3000));

            if (setInputValue('textarea[placeholder*="Ask anything" i], input[placeholder*="Ask anything" i]', 'continue')) {
                console.log('Antigravity Auto-Retry: Input "continue" set.');
            }

            await new Promise(r => setTimeout(r, 3000));

            const sendButton = findAnyButton(SEND_RE);
            if (sendButton) {
                console.log('Antigravity Auto-Retry: Clicking Send button.');
                sendButton.click();
            }
        } catch (e) {
            console.error('Antigravity Auto-Retry: Error during recovery sequence:', e);
        } finally {
            runningCounter = 0;
            hasSeenDots = false;
            isHandlingSequence = false;
        }
    }
    ` : ''}

    function tick() {
        try {
            ${(includeRetry || includeAllow || includeRun) ? `
            const buttons = document.querySelectorAll('button, a.monaco-button');
            ` : ''}
            ${includeRetry ? `
            const retryButton = findFreshEnabledButton(RETRY_RE, buttons);
            if (retryButton) {
                console.log("Antigravity Auto-Retry: Found Retry button. Clicking...");
                clickedButtons.add(retryButton);
                retryButton.click();
            }
            ` : ''}

            ${includeAllow ? `
            const allowButton = findFreshEnabledButton(ALLOW_RE, buttons);
            if (allowButton) {
                console.log("Antigravity Auto-Retry: Found Allow button. Clicking...");
                clickedButtons.add(allowButton);
                allowButton.click();
            }
            ` : ''}

            ${includeRun ? `
            const runButton = findFreshEnabledButton(RUN_RE, buttons);
            if (runButton) {
                console.log("Antigravity Auto-Retry: Found Run button. Clicking...");
                clickedButtons.add(runButton);
                runButton.click();
            }
            ` : ''}

            ${includeContinue ? `
            if (!isHandlingSequence) {
                const bodyText = document.body.innerText || '';
                const hasDots = /Running[.]{1,3}/.test(bodyText);
                const hasPlain = bodyText.includes('Running');

                if (hasDots) hasSeenDots = true;

                if (hasDots || (hasSeenDots && hasPlain)) {
                    runningCounter++;
                    if (runningCounter >= 300) { // 30s at 100ms
                        if (Date.now() - lastRecoveryAt >= RECOVERY_COOLDOWN_MS) {
                            executeRecoverySequence();
                        } else {
                            // In cooldown: stop re-triggering every 100ms.
                            runningCounter = 0;
                            hasSeenDots = false;
                        }
                    }
                } else {
                    runningCounter = 0;
                    hasSeenDots = false;
                }
            }
            ` : ''}
        } catch (e) {
            console.error("Antigravity Auto-Retry loop error:", e);
        }
    }

    setInterval(tick, 100);
})();
</script>
<!-- Antigravity Auto-Retry Patch End -->
`;
}

async function getPatchChoice() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('');
    console.log('\x1b[36m--- Patch Configuration ---\x1b[0m');
    console.log('1) All (Retry + Continue + Allow + Run) \x1b[90m[Default]\x1b[0m');
    console.log('2) Retry + Continue + Allow');
    console.log('3) Retry + Allow');
    console.log('4) Continue + Allow');
    console.log('5) Only Retry');
    console.log('6) Only Continue');
    console.log('7) Only Allow');
    console.log('8) Only Run');
    console.log('9) Reset all');

    return new Promise((resolve) => {
        rl.question('\nSelect an option (1-9) or press Enter for all: ', (answer) => {
            rl.close();
            switch (answer) {
                case '2': return resolve('retry_continue_allow');
                case '3': return resolve('retry_allow');
                case '4': return resolve('continue_allow');
                case '5': return resolve('retry');
                case '6': return resolve('continue');
                case '7': return resolve('allow');
                case '8': return resolve('run');
                case '9': return resolve('reset_all');
                default: return resolve('all');
            }
        });
    });
}

function isElevated() {
    if (process.platform === 'linux' || process.platform === 'darwin') {
        return process.getuid && process.getuid() === 0;
    } else if (process.platform === 'win32') {
        try {
            execSync('net session', { stdio: 'ignore' });
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// POSIX single-quote shell-escape: wraps in '...' and escapes embedded '.
function shellQuote(s) {
    return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Writes one or more files to protected destinations, elevating via sudo on
 * Linux/macOS when needed. Writes are batched into a single sudo invocation so
 * the user only gets prompted once. Temp files are cleaned up after.
 *   writes: [{ dest: string, content: string | Buffer }, ...]
 */
function writeElevated(writes) {
    if (writes.length === 0) return;

    if (isElevated()) {
        for (const { dest, content } of writes) {
            fs.writeFileSync(dest, content);
        }
        return;
    }

    if (process.platform === 'win32') {
        error('Insufficient privileges to modify the file. Please run this command prompt or terminal as Administrator.');
        process.exit(1);
    }

    const tmpDir = process.env.TMPDIR || '/tmp';
    const tmpFiles = [];
    const cmds = [];
    try {
        for (let i = 0; i < writes.length; i++) {
            const { dest, content } = writes[i];
            const tmp = path.join(tmpDir, `antigravity-patch-${process.pid}-${i}-${path.basename(dest)}`);
            fs.writeFileSync(tmp, content);
            tmpFiles.push(tmp);
            cmds.push(`sudo cp ${shellQuote(tmp)} ${shellQuote(dest)}`);
        }
        log('Executing sudo to copy files to system path...');
        execSync(cmds.join(' && '), { stdio: 'inherit' });
    } finally {
        for (const tmp of tmpFiles) {
            try { fs.unlinkSync(tmp); } catch (_) { /* best effort */ }
        }
    }
}

function getWorkbenchPath() {
    const relativeWorkbenchPath = path.join('resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');

    let possiblePaths = [];

    if (process.platform === 'linux') {
        possiblePaths.push(path.join('/usr', 'share', 'antigravity', relativeWorkbenchPath));
        possiblePaths.push(path.join('/opt', 'antigravity', relativeWorkbenchPath));
    } else if (process.platform === 'win32') {
        if (process.env.LOCALAPPDATA) {
            possiblePaths.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env.ProgramFiles) {
            possiblePaths.push(path.join(process.env.ProgramFiles, 'Antigravity', relativeWorkbenchPath));
        }
        if (process.env['ProgramFiles(x86)']) {
            possiblePaths.push(path.join(process.env['ProgramFiles(x86)'], 'Antigravity', relativeWorkbenchPath));
        }
    } else if (process.platform === 'darwin') {
        possiblePaths.push(path.join('/Applications', 'Antigravity.app', 'Contents', 'Resources', 'app', 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'));
    }

    log(`Searching for Antigravity installation on ${process.platform}...`);
    for (const p of possiblePaths) {
        log(`Checking: ${p}`);
        if (fs.existsSync(p)) {
            log(`Found workbench.html at: ${p}`);
            return p;
        }
    }

    return null;
}

/**
 * If product.json has a checksum entry for workbench.html, queue an update
 * so it matches the given HTML buffer. No-op when the file is absent, the
 * checksums map is missing, or the checksum already matches.
 */
function queueChecksumUpdate(writes, productJsonPath, htmlBuf, verb) {
    if (!fs.existsSync(productJsonPath)) {
        warn(`product.json not found at ${productJsonPath}; skipping checksum update.`);
        return;
    }
    const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
    if (!product.checksums || !product.checksums[CHECKSUM_KEY]) {
        warn('product.json has no matching checksum entry; skipping checksum update.');
        return;
    }
    const newSum = computeChecksum(htmlBuf);
    if (product.checksums[CHECKSUM_KEY] === newSum) return;
    log(`${verb} product.json checksum for workbench.html -> ${newSum}`);
    product.checksums[CHECKSUM_KEY] = newSum;
    writes.push({ dest: productJsonPath, content: JSON.stringify(product, null, '\t') });
}

async function resetAll(workbenchPath, backupPath, productJsonPath, productBakPath) {
    if (!fs.existsSync(backupPath)) {
        error(`Backup not found at ${backupPath}; nothing to reset.`);
        return;
    }

    log(`Found backup at ${backupPath}. Using it as clean base`);
    const restoredHtml = fs.readFileSync(backupPath);
    const writes = [{ dest: workbenchPath, content: restoredHtml }];

    if (fs.existsSync(productBakPath)) {
        log(`Restoring product.json from ${productBakPath}...`);
        writes.push({ dest: productJsonPath, content: fs.readFileSync(productBakPath) });
    } else {
        // No product.json backup (patch predates checksum support) — recompute
        // the checksum from the restored workbench.html so integrity passes.
        queueChecksumUpdate(writes, productJsonPath, restoredHtml, 'Recomputing');
    }

    writeElevated(writes);
    log('------------------------------------------');
    log('Reset successfully applied!');
    log('Please restart Antigravity to see the changes.');
    log('------------------------------------------');
}

async function patch(choice, workbenchPath, backupPath, productJsonPath, productBakPath) {
    // 1. Determine clean base content
    let cleanHtml;
    let backupOnDisk = fs.existsSync(backupPath);
    if (backupOnDisk) {
        log(`Found backup at ${backupPath}. Using it as clean base to prevent double patching.`);
        cleanHtml = fs.readFileSync(backupPath, 'utf8');
    } else {
        log(`No backup found. Reading current file and creating backup at ${backupPath}...`);
        cleanHtml = fs.readFileSync(workbenchPath, 'utf8');

        if (cleanHtml.includes('Antigravity Auto-Retry Patch')) {
            error('The current workbench.html already contains a patch but no .bak file exists.');
            error('To be safe, please manually restore a clean workbench.html or create a workbench.html.bak from a clean version.');
            return;
        }

        try {
            fs.writeFileSync(backupPath, cleanHtml);
            backupOnDisk = true;
            log('Backup created successfully.');
        } catch (e) {
            if (e.code !== 'EACCES') throw e;
            warn('Permission denied while creating backup. Will write the backup via elevated privileges in the final step.');
        }
    }

    log('Preparing patched content...');
    let html = cleanHtml;
    const injectionScript = generateInjectionScript(choice);

    // 2. Inject 'unsafe-inline' into CSP (Content Security Policy)
    html = html.replace(/(script-src\s+[^;]*)/, (match) => {
        if (!match.includes("'unsafe-inline'")) {
            log('Updating CSP to allow injected script (adding \'unsafe-inline\')...');
            return match + " 'unsafe-inline'";
        }
        return match;
    });

    // 3. Inject the script before </body> or at the end of body
    if (html.includes('</body>')) {
        log('Injecting script before </body> tag...');
        html = html.replace('</body>', injectionScript + '</body>');
    } else if (html.includes('<body')) {
        log('Injecting script after <body ...> tag...');
        html = html.replace(/(<body[^>]*>)/, (match) => match + injectionScript);
    } else {
        warn('Could not find <body> tag, appending script to the end of file.');
        html += injectionScript;
    }

    // 4. Queue writes
    const writes = [{ dest: workbenchPath, content: html }];
    if (!backupOnDisk) {
        writes.push({ dest: backupPath, content: cleanHtml });
    }

    // 5. Back up product.json (first patch only) and update its checksum
    if (fs.existsSync(productJsonPath) && !fs.existsSync(productBakPath)) {
        log(`Backing up product.json to ${productBakPath}...`);
        writes.push({ dest: productBakPath, content: fs.readFileSync(productJsonPath) });
    }
    queueChecksumUpdate(writes, productJsonPath, Buffer.from(html), 'Updating');

    // 6. Write back with privilege handling (batched into a single sudo prompt)
    log('Writing patched content back to workbench.html...');
    writeElevated(writes);
    log('Files written successfully.');

    log('------------------------------------------');
    log('Patch successfully applied!');
    log('Please restart Antigravity to see the changes.');
    log('------------------------------------------');
}

async function applyPatch() {
    log('--- Antigravity Retry Patch Utility ---');

    const choice = await getPatchChoice();
    log(`Selected mode: ${choice.toUpperCase()}`);

    const workbenchPath = getWorkbenchPath();
    if (!workbenchPath) {
        error('Could not find Antigravity installation path. Please ensure Antigravity is installed or check the script path definitions.');
        return;
    }

    const backupPath = workbenchPath + '.bak';
    const productJsonPath = getProductJsonPath(workbenchPath);
    const productBakPath = productJsonPath + '.bak';

    try {
        if (choice === 'reset_all') {
            await resetAll(workbenchPath, backupPath, productJsonPath, productBakPath);
        } else {
            await patch(choice, workbenchPath, backupPath, productJsonPath, productBakPath);
        }
    } catch (err) {
        if (err.code === 'EACCES') {
            error('Permission denied. Run the script again as administrator (sudo on Linux/macOS, "Run as Administrator" on Windows).');
        } else {
            error(`An error occurred: ${err.message}`);
        }
        process.exitCode = 1;
    }
}

applyPatch();
