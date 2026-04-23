const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIRS = new Set([
    '.agents',
    '.claude',
    '.codex',
    '.gemini',
    '.claude-plugin',
    '.codex-plugin'
]);

const HOME_ROOT_ENTRIES = new Set([
    '.agents',
    '.claude',
    '.codex',
    '.gemini',
    'AGENTS.md',
    '.mcp.json',
    '.gitignore',
    '.claude.json'
]);

const ROOT_CONFIG_FILES = new Set([
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    '.mcp.json',
    '.gitignore'
]);

const IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    '.next',
    '.astro',
    'dist',
    'build',
    'coverage',
    '.logs',
    'logs',
    'backups',
    'tmp',
    'temp'
]);

const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.ps1', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh',
    '.lua', '.rb', '.go', '.rs', '.java', '.kt', '.sql', '.xml', '.html', '.css', '.scss',
    '.less', '.env', '.gitignore'
]);

const COMMON_ALIAS_NAMES = new Set([
    '_astro',
    '_tmp',
    'agents',
    'api',
    'app',
    'apps',
    'assets',
    'auth',
    'backup',
    'backups',
    'build',
    'cache',
    'catalog',
    'chunks',
    'client',
    'collections',
    'commands',
    'components',
    'config',
    'configs',
    'content',
    'coverage',
    'data',
    'datasets',
    'demo',
    'demos',
    'dist',
    'docs',
    'encrypted',
    'examples',
    'generated',
    'hooks',
    'images',
    'inputs',
    'lib',
    'libs',
    'logs',
    'mcp-servers',
    'memory',
    'mobile',
    'node_modules',
    'notes',
    'ops',
    'output',
    'outputs',
    'packages',
    'pages',
    'plugin',
    'plugins',
    'prompts',
    'public',
    'references',
    'reports',
    'research',
    'scheduled',
    'scripts',
    'server',
    'services',
    'settings',
    'settings-snapshots',
    'shared',
    'skills',
    'snapshots',
    'src',
    'styles',
    'temp',
    'templates',
    'test',
    'tests',
    'tmp',
    'tools',
    'utils',
    'vendor',
    'web',
    'workflows',
    'worktrees'
]);

async function buildVirtualPc(options) {
    const docsRoot = path.resolve(options.docsRoot);
    const homeRoot = path.resolve(options.homeRoot);
    const outputRoot = path.resolve(options.outputRoot);
    const imageRoot = path.join(outputRoot, 'pc-image');
    const docsImageRoot = path.join(imageRoot, 'F', 'src3', 'docs');
    const homeImageRoot = path.join(imageRoot, 'C', 'Users', 'primary-user');
    const workspaceAliases = buildWorkspaceAliases(docsRoot);
    const nestedAliases = buildNestedAliases(docsRoot, workspaceAliases);
    const aliases = new Map([...workspaceAliases.entries(), ...nestedAliases.entries()]);
    const sanitizer = createSanitizer({
        docsRoot,
        docsImageRoot,
        homeRoot,
        homeImageRoot,
        aliases
    });
    const translator = createTranslator(options);
    const summary = {
        generated_at: new Date().toISOString(),
        copied_files: 0,
        skipped_binary_files: 0,
        skipped_irrelevant_files: 0,
        workspace_aliases: Array.from(workspaceAliases.values()),
        nested_alias_count: nestedAliases.size,
        translated_files: 0,
        translated_lines: 0,
        account_home: 'C:\\Users\\primary-user',
        docs_root: 'F:\\src3\\docs'
    };

    clearDirectory(outputRoot);
    fs.mkdirSync(docsImageRoot, { recursive: true });
    fs.mkdirSync(homeImageRoot, { recursive: true });

    await copyRelevantTree(docsRoot, docsImageRoot, {
        shouldInclude: shouldIncludeDocsRelative,
        shouldDescend: shouldDescendDocsRelative,
        transformRelativePath: (relativePath) => transformDocsRelativePath(relativePath, aliases),
        sanitizer,
        translator,
        summary
    });
    await copyRelevantTree(homeRoot, homeImageRoot, {
        shouldInclude: shouldIncludeHomeRelative,
        shouldDescend: shouldDescendHomeRelative,
        transformRelativePath: (relativePath) => transformHomeRelativePath(relativePath, aliases),
        sanitizer,
        translator,
        summary
    });

    const manifestPath = path.join(outputRoot, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(outputRoot, 'TESTING.md'), buildTestingGuide(summary), 'utf8');

    return {
        outputRoot,
        imageRoot,
        docsImageRoot,
        homeImageRoot,
        summary
    };
}

function buildWorkspaceAliases(docsRoot) {
    const aliases = new Map();
    let index = 1;

    for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (entry.name.startsWith('.')) {
            continue;
        }
        aliases.set(entry.name, `workspace-${String(index).padStart(3, '0')}`);
        index += 1;
    }

    return aliases;
}

function buildNestedAliases(docsRoot, workspaceAliases) {
    const aliases = new Map();
    let index = 1;

    walkDirectories(docsRoot, '', (relativePath) => {
        const segments = relativePath.split('/');
        const name = segments[segments.length - 1];
        if (segments.length <= 1) {
            return;
        }
        if (!shouldAliasNestedName(name, workspaceAliases)) {
            return;
        }
        if (!aliases.has(name)) {
            aliases.set(name, `folder-${String(index).padStart(3, '0')}`);
            index += 1;
        }
    }, shouldDescendDocsRelative);

    return aliases;
}

async function copyRelevantTree(sourceRoot, targetRoot, options) {
    const pendingFiles = [];
    walkFiles(sourceRoot, '', (relativePath, absolutePath) => {
        if (!options.shouldInclude(relativePath)) {
            options.summary.skipped_irrelevant_files += 1;
            return;
        }

        pendingFiles.push({ relativePath, absolutePath });
    }, options.shouldDescend);

    const preparedFiles = [];
    const uniqueLines = new Set();

    for (const file of pendingFiles) {
        const { relativePath, absolutePath } = file;
        const targetRelativePath = options.transformRelativePath(relativePath);
        const targetPath = path.join(targetRoot, targetRelativePath);
        if (!isTextCandidate(absolutePath)) {
            options.summary.skipped_binary_files += 1;
            continue;
        }

        const buffer = fs.readFileSync(absolutePath);
        if (looksBinary(buffer)) {
            options.summary.skipped_binary_files += 1;
            continue;
        }

        const sanitized = options.sanitizer.sanitizeText(buffer.toString('utf8'));
        collectTranslatableLines(sanitized, uniqueLines);
        preparedFiles.push({
            targetPath,
            sanitized
        });
    }

    const translations = uniqueLines.size > 0
        ? await translateLineSet(Array.from(uniqueLines), options.translator)
        : new Map();

    for (const file of preparedFiles) {
        const translated = applyLineTranslations(file.sanitized, translations);
        if (translated.translatedLines > 0) {
            options.summary.translated_files += 1;
            options.summary.translated_lines += translated.translatedLines;
        }
        fs.mkdirSync(path.dirname(file.targetPath), { recursive: true });
        fs.writeFileSync(file.targetPath, translated.text, 'utf8');
        options.summary.copied_files += 1;
    }
}

function walkFiles(rootDir, relativeDir, visitor, shouldDescend) {
    const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    let entries = [];
    try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
        return;
    }

    for (const entry of entries) {
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
            continue;
        }

        const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
        const absolutePath = path.join(rootDir, relativePath);
        if (entry.isDirectory()) {
            if (!shouldDescend || shouldDescend(relativePath)) {
                walkFiles(rootDir, relativePath, visitor, shouldDescend);
            }
            continue;
        }
        visitor(relativePath, absolutePath);
    }
}

function walkDirectories(rootDir, relativeDir, visitor, shouldDescend) {
    const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    let entries = [];
    try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) {
            continue;
        }

        const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
        if (!shouldDescend || shouldDescend(relativePath)) {
            visitor(relativePath);
            walkDirectories(rootDir, relativePath, visitor, shouldDescend);
        }
    }
}

function shouldIncludeDocsRelative(relativePath) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) {
        return false;
    }

    const basename = segments[segments.length - 1];
    if (isRelevantHostConfigPath(segments)) {
        return true;
    }
    if (ROOT_CONFIG_FILES.has(basename)) {
        return true;
    }
    if (basename === '.env' || basename.startsWith('.env.')) {
        return true;
    }
    if (/origin|research/i.test(basename) && /\.(json|ya?ml)$/iu.test(basename)) {
        return true;
    }
    return false;
}

function shouldIncludeHomeRelative(relativePath) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) {
        return false;
    }

    if (!HOME_ROOT_ENTRIES.has(segments[0])) {
        return false;
    }
    if (!CONFIG_DIRS.has(segments[0])) {
        return true;
    }
    return isRelevantHostConfigPath(segments);
}

function shouldDescendDocsRelative(relativePath) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    return !segments.some((segment) => IGNORED_DIRS.has(segment));
}

function shouldDescendHomeRelative(relativePath) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    if (segments.some((segment) => IGNORED_DIRS.has(segment))) {
        return false;
    }
    if (segments.length === 1) {
        return HOME_ROOT_ENTRIES.has(segments[0]);
    }
    if (!CONFIG_DIRS.has(segments[0])) {
        return false;
    }
    return isRelevantHostPrefix(segments);
}

function transformDocsRelativePath(relativePath, aliases) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    return segments.map((segment) => aliases.get(segment) || segment).join(path.sep);
}

function transformHomeRelativePath(relativePath, aliases) {
    const segments = relativePath.replace(/\\/g, '/').split('/');
    return segments.map((segment) => aliases.get(segment) || segment).join(path.sep);
}

function createSanitizer(options) {
    const username = path.basename(options.homeRoot);
    const literalReplacements = buildLiteralReplacements(options);
    const tokenReplacements = buildTokenReplacements(username, options.aliases);
    const emailMap = new Map();
    const githubRepoMap = new Map();
    const urlMap = new Map();

    return {
        sanitizeText(text) {
            let next = String(text || '');

            next = applyLiteralReplacements(next, literalReplacements);
            next = applyTokenReplacements(next, tokenReplacements);
            next = sanitizeEmails(next, emailMap);
            next = sanitizeGithubUrls(next, githubRepoMap);
            next = sanitizeGenericUrls(next, urlMap);
            next = redactSensitiveAssignments(next);
            next = redactTokenLikeValues(next);
            return next;
        }
    };
}

function createTranslator(options) {
    if (options.translateKorean === false) {
        return null;
    }
    if (typeof options.translator === 'function') {
        return {
            translateLine: options.translator
        };
    }
    if (options.translator && typeof options.translator.translateLine === 'function') {
        return options.translator;
    }
    return createGoogleTranslator(options);
}

function buildLiteralReplacements(options) {
    const replacements = [];
    replacements.push([
        normalizeWindowsPath(options.homeRoot),
        'C:\\Users\\primary-user'
    ]);
    replacements.push([
        escapeWindowsPathForJson(options.homeRoot),
        'C:\\\\Users\\\\primary-user'
    ]);
    replacements.push([
        normalizePosixPath(options.homeRoot),
        'C:/Users/primary-user'
    ]);
    replacements.push([
        normalizeWindowsPath(options.docsRoot),
        'F:\\src3\\docs'
    ]);
    replacements.push([
        escapeWindowsPathForJson(options.docsRoot),
        'F:\\\\src3\\\\docs'
    ]);
    replacements.push([
        normalizePosixPath(options.docsRoot),
        'F:/src3/docs'
    ]);

    return replacements.sort((left, right) => right[0].length - left[0].length);
}

function applyLiteralReplacements(text, replacements) {
    let next = text;
    for (const [from, to] of replacements) {
        if (!from) {
            continue;
        }
        next = next.split(from).join(to);
    }
    return next;
}

function buildTokenReplacements(username, aliases) {
    const replacements = new Map();
    replacements.set(username, 'primary-user');

    for (const [original, alias] of aliases.entries()) {
        replacements.set(original, alias);
        const upper = String(original || '').toUpperCase();
        if (upper && upper !== original && upper.length >= 4) {
            replacements.set(upper, alias);
        }
        const humanized = humanizeSegment(original);
        if (humanized !== original && humanized.length >= 5) {
            replacements.set(humanized, alias);
        }
    }

    return Array.from(replacements.entries()).sort((left, right) => right[0].length - left[0].length);
}

function applyTokenReplacements(text, replacements) {
    let next = text;
    for (const [from, to] of replacements) {
        if (!from) {
            continue;
        }
        const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegex(from)}(?![A-Za-z0-9])`, 'gu');
        next = next.replace(pattern, to);
    }
    return next;
}

function sanitizeEmails(text, emailMap) {
    let counter = emailMap.size + 1;
    return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, (value) => {
        if (!emailMap.has(value)) {
            emailMap.set(value, `user-${String(counter).padStart(3, '0')}@example.invalid`);
            counter += 1;
        }
        return emailMap.get(value);
    });
}

function sanitizeGithubUrls(text, repoMap) {
    let counter = repoMap.size + 1;
    return text.replace(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[^\s"'`<>)]*)?/giu, (value, owner, repo) => {
        const key = `${owner}/${repo}`;
        if (!repoMap.has(key)) {
            repoMap.set(key, `repo-${String(counter).padStart(3, '0')}`);
            counter += 1;
        }
        return `https://github.com/example-org/${repoMap.get(key)}`;
    });
}

function sanitizeGenericUrls(text, urlMap) {
    let counter = urlMap.size + 1;
    return text.replace(/https?:\/\/[^\s"'`<>)]*/giu, (value) => {
        if (/https?:\/\/github\.com\//iu.test(value)) {
            return value;
        }
        if (!urlMap.has(value)) {
            urlMap.set(value, `https://example.invalid/url-${String(counter).padStart(3, '0')}`);
            counter += 1;
        }
        return urlMap.get(value);
    });
}

function containsHangul(value) {
    return /\p{Script=Hangul}/u.test(String(value || ''));
}

function createGoogleTranslator(options) {
    const cache = new Map();

    return {
        async translateLine(line) {
            const translated = await translateLineSet([line], this);
            return translated.get(line) || line;
        },
        async translateLines(lines) {
            const uniqueLines = Array.from(new Set((lines || [])
                .map((line) => String(line || ''))
                .filter((line) => containsHangul(line))));
            const results = new Map();
            const pending = [];

            for (const line of uniqueLines) {
                if (cache.has(line)) {
                    results.set(line, cache.get(line));
                } else {
                    pending.push(line);
                }
            }

            await mapWithConcurrency(pending, 8, async (line) => {
                const translated = await translateLargeLine(line);
                cache.set(line, translated);
                results.set(line, translated);
            });
            return results;
        }
    };
}

async function translateLargeLine(line) {
    const chunks = splitTranslationChunks(line, 1600);
    const translatedChunks = [];
    for (const chunk of chunks) {
        translatedChunks.push(await requestGoogleTranslation(chunk));
    }
    return translatedChunks.join('');
}

function splitTranslationChunks(line, maxLength) {
    const source = String(line || '');
    if (source.length <= maxLength) {
        return [source];
    }

    const chunks = [];
    let remaining = source;
    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf(' ', maxLength);
        if (splitAt < Math.floor(maxLength / 2)) {
            splitAt = maxLength;
        }
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt);
    }
    if (remaining) {
        chunks.push(remaining);
    }
    return chunks;
}

async function requestGoogleTranslation(text) {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'ko');
    url.searchParams.set('tl', 'en');
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', text);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'soft-harness/0.4.26'
                }
            });
            if (!response.ok) {
                throw new Error(`translation request failed: ${response.status}`);
            }

            const payload = await response.json();
            const translated = Array.isArray(payload?.[0])
                ? payload[0].map((part) => Array.isArray(part) ? part[0] : '').join('')
                : '';

            if (!translated || containsHangul(translated)) {
                throw new Error('translation response was empty or still contained Hangul');
            }
            return translated;
        } catch (error) {
            if (attempt === 2) {
                return fallbackEnglishText(text);
            }
            await sleep((attempt + 1) * 250);
        }
    }

    return fallbackEnglishText(text);
}

function collectTranslatableLines(text, uniqueLines) {
    if (!containsHangul(text)) {
        return;
    }

    for (const line of String(text || '').split('\n')) {
        if (containsHangul(line)) {
            uniqueLines.add(line);
        }
    }
}

async function translateLineSet(lines, translator) {
    const uniqueLines = Array.from(new Set((lines || [])
        .map((line) => String(line || ''))
        .filter((line) => containsHangul(line))));
    if (!translator || uniqueLines.length === 0) {
        return new Map();
    }
    if (typeof translator.translateLines === 'function') {
        return translator.translateLines(uniqueLines);
    }

    const results = new Map();
    await mapWithConcurrency(uniqueLines, 8, async (line) => {
        results.set(line, await translator.translateLine(line));
    });
    return results;
}

function applyLineTranslations(text, translations) {
    if (!containsHangul(text) || !translations || translations.size === 0) {
        return {
            text,
            translatedLines: 0
        };
    }

    const lines = String(text || '').split('\n');
    let translatedLines = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const translated = translations.get(lines[index]);
        if (!translated) {
            continue;
        }
        lines[index] = translated;
        translatedLines += 1;
    }

    return {
        text: lines.join('\n'),
        translatedLines
    };
}

async function mapWithConcurrency(items, concurrency, worker) {
    const queue = items.slice();
    const runners = [];
    const limit = Math.max(1, concurrency);
    for (let index = 0; index < Math.min(limit, queue.length); index += 1) {
        runners.push((async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                await worker(item);
            }
        })());
    }
    await Promise.all(runners);
}

function fallbackEnglishText(text) {
    const normalized = String(text || '').replace(/\p{Script=Hangul}+/gu, '[Korean text]');
    return normalized === String(text || '')
        ? '[Korean text]'
        : normalized;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactSensitiveAssignments(text) {
    return text.replace(
        /^(\s*["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|cookie|session|authorization|auth|private[_-]?key|owner|username)["']?\s*[:=]\s*)(.+)$/gimu,
        (_, prefix, value) => `${prefix}${preserveQuotedPlaceholder(value)}`
    );
}

function redactTokenLikeValues(text) {
    return text
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]+)\b/gu, '<REDACTED_TOKEN>')
        .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/gu, '<REDACTED_BLOB>');
}

function preserveQuotedPlaceholder(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return '"<REDACTED>"';
    }
    if (trimmed.startsWith('\'') && trimmed.endsWith('\'')) {
        return '\'<REDACTED>\'';
    }
    return '<REDACTED>';
}

function isTextCandidate(filePath) {
    const basename = path.basename(filePath);
    if (basename === '.env' || basename.startsWith('.env.')) {
        return true;
    }
    if (basename === '.gitignore') {
        return true;
    }
    return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function looksBinary(buffer) {
    if (!buffer || buffer.length === 0) {
        return false;
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
    for (const byte of sample) {
        if (byte === 0) {
            return true;
        }
    }
    return false;
}

function normalizeWindowsPath(value) {
    return String(value || '').replace(/\//g, '\\');
}

function normalizePosixPath(value) {
    return String(value || '').replace(/\\/g, '/');
}

function escapeWindowsPathForJson(value) {
    return normalizeWindowsPath(value).replace(/\\/g, '\\\\');
}

function humanizeSegment(value) {
    return String(value || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldAliasNestedName(name, workspaceAliases) {
    const value = String(name || '');
    if (!value || value.startsWith('.') || CONFIG_DIRS.has(value) || workspaceAliases.has(value)) {
        return false;
    }

    const lower = value.toLowerCase();
    if (COMMON_ALIAS_NAMES.has(lower)) {
        return false;
    }
    if (value.length < 5) {
        return false;
    }
    if (/^[a-z]+$/u.test(value)) {
        return false;
    }
    return /[-_]|[A-Z].*[a-z]|[a-z].*[A-Z]|\d/u.test(value);
}

function buildTestingGuide(summary) {
    return [
        '# Virtual PC Test Environment',
        '',
        'This sandbox contains a sanitized Windows-like filesystem for testing the plugin-first `soft-harness` workflow with an LLM.',
        '',
        '## Layout',
        '',
        '- Account home: `pc-image/C/Users/primary-user`',
        '- Workspace mirror: `pc-image/F/src3/docs`',
        '',
        '## What Was Included',
        '',
        '- host instruction files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`',
        '- host config trees under `.claude/`, `.codex/`, `.gemini/`, and `.agents/`',
        '- lightweight research packets such as origin JSON/YAML files when present',
        '',
        '## What Was Removed Or Redacted',
        '',
        '- pre-existing `.harness/` snapshots so the sandbox starts from host-authoritative files only',
        '- usernames, emails, repo names, and workspace names',
        '- URLs rewritten to generic placeholders',
        '- token, password, secret, and cookie values replaced with placeholders',
        '- irrelevant source code, logs, caches, and binary blobs skipped',
        '',
        '## Suggested LLM Test Flows',
        '',
        '1. Open one of the `workspace-*` folders in Claude Code or Codex and ask the `analyze` skill to run in dry-run mode.',
        '2. Ask the `organize` skill to show current state, move one MCP server to a single host, and propose optimizations.',
        '3. Ask the `organize` skill to remember a new durable rule and confirm it lands in `.harness/memory/`.',
        '4. Ask the `organize` skill to inspect host settings, explain malformed MCP definitions, and suggest fixes.',
        '',
        '## Summary',
        '',
        `- Copied files: ${summary.copied_files}`,
        `- Skipped irrelevant files: ${summary.skipped_irrelevant_files}`,
        `- Skipped binary files: ${summary.skipped_binary_files}`,
        `- Translated files: ${summary.translated_files}`,
        `- Translated lines: ${summary.translated_lines}`,
        `- Sanitized workspaces: ${summary.workspace_aliases.length}`,
        ''
    ].join('\n');
}

function clearDirectory(targetPath) {
    if (!fs.existsSync(targetPath)) {
        return;
    }

    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
        const absolutePath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            fs.rmSync(absolutePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        } else {
            fs.rmSync(absolutePath, { force: true, maxRetries: 5, retryDelay: 50 });
        }
    }
}

function isRelevantHostConfigPath(segments) {
    const index = segments.findIndex((segment) => CONFIG_DIRS.has(segment));
    if (index === -1) {
        return false;
    }

    return isRelevantHostTree(segments[index], segments.slice(index + 1));
}

function isRelevantHostTree(host, rest) {
    if (host === '.claude-plugin' || host === '.codex-plugin') {
        return true;
    }
    if (rest.length === 0) {
        return false;
    }

    const basename = rest[rest.length - 1];
    switch (host) {
        case '.agents':
            return ['plugins', 'skills'].includes(rest[0]);
        case '.claude':
            if (rest.length === 1 && ['CLAUDE.md', 'settings.json', 'settings.local.json', 'mcp-needs-auth-cache.json'].includes(rest[0])) {
                return true;
            }
            if (['agents', 'commands', 'hooks', 'mcp-servers', 'skills'].includes(rest[0])) {
                return true;
            }
            if (rest[0] === 'plugins') {
                return isRelevantClaudePluginPath(rest.slice(1), basename);
            }
            return false;
        case '.codex':
            if (rest.length === 1 && ['config.toml', 'AGENTS.md'].includes(rest[0])) {
                return true;
            }
            return ['agents', 'plugins', 'skills'].includes(rest[0]);
        case '.gemini':
            if (rest.length === 1 && ['settings.json', 'GEMINI.md'].includes(rest[0])) {
                return true;
            }
            return ['agents', 'plugins', 'skills'].includes(rest[0]);
        default:
            return false;
    }
}

function isRelevantHostPrefix(segments) {
    const host = segments[0];
    const rest = segments.slice(1);
    if (host === '.claude-plugin' || host === '.codex-plugin') {
        return true;
    }
    if (rest.length === 0) {
        return true;
    }

    switch (host) {
        case '.agents':
            return ['plugins', 'skills'].includes(rest[0]);
        case '.claude':
            if (['agents', 'commands', 'hooks', 'mcp-servers', 'skills'].includes(rest[0])) {
                return true;
            }
            if (rest[0] === 'plugins') {
                return rest.length === 1 || ['cache', 'marketplaces'].includes(rest[1]) || /\.(json|ya?ml|toml)$/iu.test(rest[rest.length - 1]);
            }
            return false;
        case '.codex':
        case '.gemini':
            return ['agents', 'plugins', 'skills'].includes(rest[0]);
        default:
            return false;
    }
}

function isRelevantClaudePluginPath(rest, basename) {
    if (rest.length === 0) {
        return false;
    }
    if (rest[0] === 'cache') {
        return ['plugin.json', 'marketplace.json', 'package.json', 'config'].includes(basename);
    }
    if (rest[0] === 'marketplaces') {
        return ['marketplace.json', 'config'].includes(basename);
    }
    return /\.(json|ya?ml|toml)$/iu.test(basename);
}

module.exports = {
    buildVirtualPc,
    shouldIncludeDocsRelative,
    shouldIncludeHomeRelative
};
