const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Antigravity Auto-Retry Patch Utility
 * This script injects a small JavaScript snippet into the Antigravity workbench
 * to automatically click "Retry" buttons when they appear.
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

const INJECTION_SCRIPT = `
<!-- Antigravity Auto-Retry Patch Start -->
<script type="text/javascript">
(function() {
    console.log("Antigravity Auto-Retry: Direct Injection successful.");
    let intervalId = null;
    function startAutoRetry() {
        if (intervalId) return;
        intervalId = setInterval(() => {
            const buttons = Array.from(document.querySelectorAll("button, a.monaco-button"));
            const retryButton = buttons.find(button => {
                const text = (button.textContent || "").toLowerCase();
                return text.includes("retry") || 
                       text.includes("wiederholen") || 
                       text.includes("try again") || 
                       text.includes("fortfahren");
            });
            if (retryButton && !(retryButton.disabled)) {
                console.log("Antigravity Auto-Retry: Found button. Clicking...");
                retryButton.click();
            }
        }, 1000);
    }
    startAutoRetry();
})();
</script>
<!-- Antigravity Auto-Retry Patch End -->
`;

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

async function applyPatch() {
    log('--- Antigravity Retry Patch Utility ---');
    
    const workbenchPath = getWorkbenchPath();
    if (!workbenchPath) {
        error('Could not find Antigravity installation path. Please ensure Antigravity is installed or check the script path definitions.');
        return;
    }

    const backupPath = workbenchPath + '.bak';

    try {
        log(`Reading workbench file...`);
        let html = fs.readFileSync(workbenchPath, 'utf8');

        // 1. Create backup if it doesn't exist
        if (!fs.existsSync(backupPath)) {
            log(`Creating backup at: ${backupPath}`);
            try {
                fs.writeFileSync(backupPath, html);
                log('Backup created successfully.');
            } catch (e) {
                if (e.code === 'EACCES') {
                    warn('Permission denied while creating backup. Attempting to proceed with elevated privileges later...');
                } else {
                    throw e;
                }
            }
        } else {
            log('Backup already exists, skipping backup creation.');
        }

        // 2. Check if already patched
        if (html.includes('Antigravity Auto-Retry Patch')) {
            log('Patch already appears to be applied in the file. No changes needed.');
            log('Success! (Verified)');
            return;
        }

        log('Preparing patched content...');

        // 3. Inject 'unsafe-inline' into CSP (Content Security Policy)
        // This is necessary because we are injecting a raw <script> tag.
        const originalHtmlLength = html.length;
        html = html.replace(/(script-src\s+[^;]*)/, (match) => {
            if (!match.includes("'unsafe-inline'")) {
                log('Updating CSP to allow injected script (adding \'unsafe-inline\')...');
                return match + " 'unsafe-inline'";
            }
            return match;
        });

        // 4. Inject the script before </body> or at the end of body
        if (html.includes('</body>')) {
            log('Injecting script before </body> tag...');
            html = html.replace('</body>', INJECTION_SCRIPT + '</body>');
        } else if (html.includes('<body')) {
            log('Injecting script after <body ...> tag...');
            html = html.replace(/(<body[^>]*>)/, (match) => match + INJECTION_SCRIPT);
        } else {
            warn('Could not find <body> tag, appending script to the end of file.');
            html += INJECTION_SCRIPT;
        }

        if (html.length === originalHtmlLength) {
            error('Injection failed: content was not modified. Please check the file structure of workbench.html.');
            return;
        }

        // 5. Write back with privilege handling
        log('Writing patched content back to workbench.html...');
        
        if (isElevated()) {
            log('Running with sufficient privileges. Writing directly...');
            fs.writeFileSync(workbenchPath, html);
            log('File written successfully.');
        } else {
            log('Not running with elevated privileges. Attempting to use platform-specific elevation...');
            
            if (process.platform === 'linux' || process.platform === 'darwin') {
                const tempPath = path.join(process.env.TMPDIR || '/tmp', 'workbench_patched.html');
                log(`Writing temporary file to ${tempPath}...`);
                fs.writeFileSync(tempPath, html);
                
                log('Executing sudo to copy the file to the system path...');
                execSync(`sudo cp "${tempPath}" "${workbenchPath}"`);
                log('File moved successfully using sudo.');
            } else if (process.platform === 'win32') {
                error('Insufficient privileges to modify the file. Please run this command prompt or terminal as Administrator.');
                process.exit(1);
            }
        }

        log('------------------------------------------');
        log('Patch successfully applied!');
        log('Please restart Antigravity to see the changes.');
        log('------------------------------------------');

    } catch (err) {
        error(`An error occurred during the patching process: ${err.message}`);
        if (err.code === 'EACCES' || err.message.includes('permission denied')) {
            if (process.platform === 'win32') {
                error('Hint: Right-click your terminal (PowerShell/CMD) and select "Run as Administrator".');
            } else {
                error('Hint: Try running the script with sudo: sudo node applyRetryPatch.js');
            }
        }
    }
}

applyPatch();
