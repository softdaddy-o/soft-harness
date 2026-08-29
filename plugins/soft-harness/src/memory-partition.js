const path = require('node:path');
const { createBackup } = require('./backup');
const { buildInstructionState, exportInstructions } = require('./export');
const { copyPath, exists, readJson, readUtf8, walkFiles, writeJson, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { getProfile, listProfiles } = require('./profiles');
const { getDefaultState, loadState, saveState } = require('./state');

const SHARED_MEMORY_PATH = '.harness/memory/shared.md';
const PROJECT_STATE_PATH = 'docs/memory-project-state.md';
const PARTITION_STATE_PATH = '.harness/memory/partition-state.json';
const SHARED_SECTION = 'Partitioned Host Memory';
const PROJECT_STATE_TITLE = 'Memory Project State';

function analyzeMemoryPartition(rootDir, options) {
    const files = findHostMemoryFiles(rootDir, options || {});
    const entries = [];

    for (const file of files) {
        const content = readUtf8(file.absolutePath);
        for (const parsed of parseMemoryEntries(content, file)) {
            const sourceHost = parsed.sourceHost || file.host || 'unknown';
            const entryHash = hashString(parsed.text);
            entries.push({
                ...parsed,
                sourceHost,
                sourcePath: parsed.file,
                entryHash,
                ...classifyMemoryEntry(parsed.text, {
                    ...(options || {}),
                    sourceHost
                })
            });
        }
    }

    return {
        files,
        entries,
        summary: summarizeEntries(entries)
    };
}

function runPartitionMemory(rootDir, options) {
    const partition = analyzeMemoryPartition(rootDir, options || {});
    const dryRun = Boolean(options && options.dryRun);
    const plan = buildPartitionPlan(partition.entries);
    const actionCount = plan.crossHost.length + plan.projectState.length + plan.stale.length;

    if (dryRun) {
        return {
            phase: 'dry-run',
            ...partition,
            plan: toPublicPlan(plan),
            backupTs: null,
            exports: []
        };
    }

    if (actionCount === 0) {
        const ledger = updatePartitionState(rootDir, partition.entries, options || {});
        return {
            phase: 'completed',
            ...partition,
            plan: toPublicPlan(plan),
            backupTs: null,
            exports: [],
            routes: [],
            ledger
        };
    }

    const backup = createPartitionBackup(rootDir, partition.files, plan);

    applySharedMemory(rootDir, plan.crossHost);
    applyProjectState(rootDir, plan.projectState);
    applyMemoryRewrites(plan.byFile);
    const ledger = updatePartitionState(rootDir, partition.entries, options || {});

    const state = loadState(rootDir);
    const exportResult = exportInstructions(rootDir, { state });
    saveState(rootDir, {
        ...state,
        assets: {
            ...getDefaultState().assets,
            ...state.assets,
            instructions: buildInstructionState(rootDir, state)
        }
    });

    return {
        phase: 'completed',
        ...partition,
        plan: toPublicPlan(plan),
        backupTs: backup ? backup.timestamp : null,
        exports: exportResult.exported,
        routes: exportResult.routes || [],
        ledger
    };
}

function findHostMemoryFiles(rootDir, options) {
    return [
        ...findClaudeMemoryFiles(rootDir, options || {}),
        ...findCodexMemoryFiles(rootDir, options || {})
    ].sort((left, right) => {
        const hostCompare = left.host.localeCompare(right.host);
        if (hostCompare !== 0) {
            return hostCompare;
        }
        return left.relativePath.localeCompare(right.relativePath);
    });
}

function findClaudeMemoryFiles(rootDir, options) {
    const roots = getMemorySearchRoots(rootDir, options || {});
    const files = [];
    const seen = new Set();

    for (const searchRoot of roots) {
        const projectsDir = path.join(searchRoot, '.claude', 'projects');
        if (!exists(projectsDir)) {
            continue;
        }

        for (const file of walkFiles(projectsDir, (relativePath) => normalizePath(relativePath).endsWith('/memory/MEMORY.md'))) {
            const absolutePath = file.absolutePath;
            if (seen.has(absolutePath)) {
                continue;
            }
            seen.add(absolutePath);
            files.push({
                host: 'claude',
                absolutePath,
                relativePath: normalizePath(path.join('.claude', 'projects', file.relativePath)),
                rootDir: searchRoot,
                project: normalizePath(file.relativePath).split('/')[0] || '(unknown)'
            });
        }
    }

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function findCodexMemoryFiles(rootDir, options) {
    const roots = getMemorySearchRoots(rootDir, options || {});
    const files = [];
    const seen = new Set();

    for (const searchRoot of roots) {
        const memoriesDir = path.join(searchRoot, '.codex', 'memories');
        if (!exists(memoriesDir)) {
            continue;
        }

        for (const file of walkFiles(memoriesDir, isLikelyTextMemoryFile)) {
            const absolutePath = file.absolutePath;
            if (seen.has(absolutePath)) {
                continue;
            }
            seen.add(absolutePath);
            files.push({
                host: 'codex',
                absolutePath,
                relativePath: normalizePath(path.join('.codex', 'memories', file.relativePath)),
                rootDir: searchRoot,
                project: '(codex)'
            });
        }
    }

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function isLikelyTextMemoryFile(relativePath) {
    return /\.(md|markdown|txt)$/iu.test(normalizePath(relativePath));
}

function getMemorySearchRoots(rootDir, options) {
    const roots = [path.resolve(rootDir)];
    if (options.accountRoot) {
        roots.push(path.resolve(options.accountRoot));
    }
    return Array.from(new Set(roots));
}

function parseMemoryEntries(content, file) {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const entries = [];
    let current = null;

    function finishCurrent() {
        if (!current) {
            return;
        }
        const text = normalizeEntryText(current.textLines.join(' '));
        if (text && !isGeneratedPartitionMarker(text)) {
            entries.push({
                file: file.relativePath,
                absolutePath: file.absolutePath,
                sourceHost: file.host || 'unknown',
                project: file.project,
                line: current.startLine,
                endLine: current.endLine,
                raw: current.rawLines.join('\n'),
                text
            });
        }
        current = null;
    }

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const bulletMatch = line.match(/^[-*+]\s+(.*)$/u);
        if (bulletMatch) {
            finishCurrent();
            current = {
                startLine: index + 1,
                endLine: index + 1,
                rawLines: [line],
                textLines: [bulletMatch[1]]
            };
            continue;
        }

        if (!line.trim()) {
            finishCurrent();
            continue;
        }

        if (line.trim().startsWith('#')) {
            finishCurrent();
            continue;
        }

        if (current) {
            current.endLine = index + 1;
            current.rawLines.push(line);
            current.textLines.push(line.trim());
            continue;
        }

        current = {
            startLine: index + 1,
            endLine: index + 1,
            rawLines: [line],
            textLines: [line.trim()]
        };
    }

    finishCurrent();
    return entries;
}

function classifyMemoryEntry(text, options) {
    const normalized = normalizeEntryText(text);
    const ageDays = getAsOfAgeDays(normalized, options && options.now);
    const sourceHost = (options && options.sourceHost) || 'claude';

    if (isStaleMemory(normalized, ageDays)) {
        return {
            action: 'remove',
            classification: 'stale',
            confidence: 'high',
            destination: 'MEMORY.md',
            reason: 'entry is explicitly stale or has an old active-as-of date'
        };
    }

    if (isProjectStateMemory(normalized)) {
        return {
            action: 'move',
            classification: 'project-state',
            confidence: 'medium',
            destination: PROJECT_STATE_PATH,
            reason: 'entry references issues, dates, decisions, blockers, or follow-up state'
        };
    }

    if (isCrossHostMemory(normalized)) {
        return {
            action: 'mirror',
            classification: 'cross-host',
            confidence: 'medium',
            destination: SHARED_MEMORY_PATH,
            reason: 'entry describes environment paths, credentials, repository policy, or cross-host conventions'
        };
    }

    if (isHostOnlyMemory(normalized, sourceHost)) {
        return {
            action: 'keep',
            classification: `${sourceHost}-only`,
            confidence: 'medium',
            destination: `${sourceHost} memory`,
            reason: `entry appears specific to ${sourceHost} behavior or feedback`
        };
    }

    return {
        action: 'keep',
        classification: `${sourceHost}-only`,
        confidence: 'low',
        destination: `${sourceHost} memory`,
        reason: 'entry lacks a clear cross-host or project-state signal'
    };
}

function isStaleMemory(text, ageDays) {
    return /\b(stale|obsolete|deprecated|no longer relevant|remove after)\b/iu.test(text)
        || (typeof ageDays === 'number' && ageDays > 120);
}

function isProjectStateMemory(text) {
    return /\b(github issue|issue\s*#\d+|bug|wip|follow-up|follow up|blocked|blocker|release blocker|architecture decision|decision record|commit\s+[0-9a-f]{7,}|cl\s*#?\d+|active as of)\b/iu.test(text);
}

function isCrossHostMemory(text) {
    return /[A-Z]:\\/u.test(text)
        || /\b(credentials?|secrets?|env|environment|path|git|worktree|p4|perforce|trash-cli|convention|agents\.md|repository rule|hardcode)\b/iu.test(text);
}

function isHostOnlyMemory(text, sourceHost) {
    if (sourceHost === 'codex') {
        return isCodexOnlyMemory(text);
    }
    if (sourceHost === 'claude') {
        return isClaudeOnlyMemory(text);
    }
    return false;
}

function isClaudeOnlyMemory(text) {
    return /^(feedback|claude feedback)\s*:/iu.test(text)
        || /\b(claude code|slash-command|slash command|skill tool|claude-only|tool permission|memory write)\b/iu.test(text);
}

function isCodexOnlyMemory(text) {
    return /^(feedback|codex feedback)\s*:/iu.test(text)
        || /\b(codex|openai|sandbox|approval|tui|codex cli|codex-only|memories|chronicle)\b/iu.test(text);
}

function getAsOfAgeDays(text, now) {
    const match = text.match(/\bactive\s+as\s+of\s+(\d{4}-\d{2}-\d{2})\b/iu);
    if (!match) {
        return null;
    }
    const current = now instanceof Date ? now : new Date();
    const date = new Date(`${match[1]}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return Math.floor((current.getTime() - date.getTime()) / 86400000);
}

function summarizeEntries(entries) {
    const summary = {
        total: entries.length,
        claude_only: 0,
        codex_only: 0,
        cross_host: 0,
        project_state: 0,
        stale: 0
    };

    for (const entry of entries) {
        const key = entry.classification.replace(/-/gu, '_');
        if (Object.prototype.hasOwnProperty.call(summary, key)) {
            summary[key] += 1;
        }
    }

    return summary;
}

function buildPartitionPlan(entries) {
    const actionable = (entries || []).filter((entry) => entry.action !== 'keep');
    const byFile = new Map();

    for (const entry of actionable) {
        if (!byFile.has(entry.absolutePath)) {
            byFile.set(entry.absolutePath, []);
        }
        byFile.get(entry.absolutePath).push(entry);
    }

    return {
        crossHost: actionable.filter((entry) => entry.classification === 'cross-host'),
        projectState: actionable.filter((entry) => entry.classification === 'project-state'),
        stale: actionable.filter((entry) => entry.classification === 'stale'),
        byFile
    };
}

function toPublicPlan(plan) {
    return {
        crossHost: plan.crossHost,
        projectState: plan.projectState,
        stale: plan.stale
    };
}

function createPartitionBackup(rootDir, files, plan) {
    const externalFiles = files.filter((file) => plan.byFile.has(file.absolutePath) && isExternalFile(rootDir, file));
    const backupTargets = buildBackupTargets(rootDir, files, plan);
    let backup = createBackup(rootDir, backupTargets, { reason: 'partition-memory' });

    if (!backup && externalFiles.length > 0) {
        backup = createBackup(rootDir, [SHARED_MEMORY_PATH], { reason: 'partition-memory' });
    }
    if (backup && externalFiles.length > 0) {
        appendExternalBackups(backup, externalFiles);
    }
    return backup;
}

function buildBackupTargets(rootDir, files, plan) {
    const targets = new Set();
    const hasActions = plan.crossHost.length > 0 || plan.projectState.length > 0 || plan.stale.length > 0;
    for (const file of files) {
        if (plan.byFile.has(file.absolutePath) && !isExternalFile(rootDir, file)) {
            targets.add(file.relativePath);
        }
    }
    if (hasActions) {
        targets.add(PARTITION_STATE_PATH);
        for (const profileName of listProfiles()) {
            for (const instructionFile of getProfile(profileName).instruction_files) {
                targets.add(instructionFile);
            }
        }
    }
    if (plan.crossHost.length > 0) {
        targets.add(SHARED_MEMORY_PATH);
    }
    if (plan.projectState.length > 0) {
        targets.add(PROJECT_STATE_PATH);
    }
    return Array.from(targets).sort();
}

function appendExternalBackups(backup, files) {
    const manifest = readJson(backup.manifestPath);
    for (const file of files) {
        const backupPath = normalizePath(path.join(
            'external',
            hashString(file.absolutePath).slice(0, 12),
            path.basename(file.absolutePath)
        ));
        copyPath(file.absolutePath, path.join(backup.backupDir, backupPath));
        manifest.entries.push({
            path: `external:${file.absolutePath}`,
            kind: 'external-file',
            originalPath: file.absolutePath,
            backupPath
        });
    }
    writeJson(backup.manifestPath, manifest);
    backup.entryCount = manifest.entries.length;
}

function isExternalFile(rootDir, file) {
    return path.resolve(file.rootDir) !== path.resolve(rootDir);
}

function applySharedMemory(rootDir, entries) {
    if (!entries || entries.length === 0) {
        return;
    }
    const targetPath = path.join(rootDir, SHARED_MEMORY_PATH);
    const before = exists(targetPath) ? readUtf8(targetPath) : '';
    const after = appendImportedEntries(before, SHARED_SECTION, entries);
    if (after !== before) {
        writeUtf8(targetPath, after);
    }
}

function applyProjectState(rootDir, entries) {
    if (!entries || entries.length === 0) {
        return;
    }
    const targetPath = path.join(rootDir, PROJECT_STATE_PATH);
    const before = exists(targetPath) ? readUtf8(targetPath) : `# ${PROJECT_STATE_TITLE}\n`;
    const after = appendImportedEntries(before, SHARED_SECTION, entries);
    if (after !== before) {
        writeUtf8(targetPath, after);
    }
}

function applyMemoryRewrites(byFile) {
    for (const [absolutePath, entries] of byFile.entries()) {
        const before = readUtf8(absolutePath);
        const after = rewriteMemoryContent(before, entries);
        if (after !== before) {
            writeUtf8(absolutePath, after);
        }
    }
}

function rewriteMemoryContent(content, entries) {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const sorted = entries.slice().sort((left, right) => right.line - left.line);

    for (const entry of sorted) {
        const start = Math.max(0, entry.line - 1);
        const deleteCount = Math.max(1, entry.endLine - entry.line + 1);
        if (entry.classification === 'stale') {
            lines.splice(start, deleteCount);
            continue;
        }
        lines.splice(start, deleteCount, `- [${stubLabel(entry)}] ${previewText(entry.text)}`);
    }

    return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()}\n`;
}

function stubLabel(entry) {
    if (entry.classification === 'cross-host') {
        return `soft-harness: mirrored to ${SHARED_MEMORY_PATH} from ${entry.sourceHost || 'host'} memory; do not reverse-merge`;
    }
    if (entry.classification === 'project-state') {
        return `soft-harness: moved to ${PROJECT_STATE_PATH} from ${entry.sourceHost || 'host'} memory; do not reverse-merge`;
    }
    return 'Reviewed by partition-memory';
}

function appendImportedEntries(content, section, entries) {
    const normalized = String(content || '').replace(/\r\n/g, '\n').trim();
    const existingHashes = new Set(Array.from(normalized.matchAll(/entry-hash=([0-9a-f]+)/giu)).map((match) => match[1]));
    const blocks = [];

    for (const entry of entries || []) {
        const text = normalizeEntryText(entry.text);
        const entryHash = entry.entryHash || hashString(text);
        if (!text || existingHashes.has(entryHash) || normalized.includes(text)) {
            continue;
        }
        existingHashes.add(entryHash);
        blocks.push(renderImportedEntry(entry, text, entryHash));
    }

    if (blocks.length === 0) {
        return normalized ? `${normalized}\n` : '';
    }

    const block = [
        `## ${section}`,
        '',
        ...blocks
    ].join('\n');

    if (!normalized) {
        return `${block}\n`;
    }
    if (normalized.includes(`## ${section}`)) {
        return `${normalized}\n${blocks.join('\n')}\n`;
    }
    return `${normalized}\n\n${block}\n`;
}

function renderImportedEntry(entry, text, entryHash) {
    const sourceHost = entry.sourceHost || 'host';
    const sourcePath = normalizePath(entry.sourcePath || entry.file || '');
    const destination = normalizePath(entry.destination || '');
    return [
        `<!-- soft-harness: imported-memory; source-host=${sourceHost}; source-path=${sourcePath}; destination=${destination}; entry-hash=${entryHash}; do-not-reverse-merge=true -->`,
        `- [Imported from ${sourceHost} memory; do not reverse-merge into host memory] ${text}`
    ].join('\n');
}

function updatePartitionState(rootDir, entries, options) {
    const statePath = path.join(rootDir, PARTITION_STATE_PATH);
    const before = readJson(statePath, { schema: 1, entries: [] });
    const now = getStateTimestamp(options && options.now);
    const previousById = new Map(((before && before.entries) || []).map((entry) => [entry.id, entry]));
    const nextEntries = [];
    const seen = new Set();

    for (const entry of entries || []) {
        const id = getPartitionEntryId(entry);
        const previous = previousById.get(id);
        seen.add(id);
        nextEntries.push({
            id,
            sourceHost: entry.sourceHost || 'unknown',
            sourcePath: normalizePath(entry.sourcePath || entry.file || ''),
            sourceProject: entry.project || null,
            sourceLine: entry.line || null,
            entryHash: entry.entryHash || hashString(entry.text),
            classification: entry.classification,
            action: entry.action,
            destination: entry.destination,
            status: getLedgerStatus(entry),
            firstSeenAt: previous ? previous.firstSeenAt : now,
            lastSeenAt: now
        });
    }

    for (const previous of (before && before.entries) || []) {
        if (seen.has(previous.id)) {
            continue;
        }
        if (previous.status !== 'observed') {
            nextEntries.push(previous);
            continue;
        }
        nextEntries.push({
            ...previous,
            status: 'missing',
            missingSince: previous.missingSince || now
        });
    }

    const after = {
        schema: 1,
        updatedAt: now,
        entries: nextEntries.sort((left, right) => left.id.localeCompare(right.id))
    };

    writeJson(statePath, after);
    return {
        path: PARTITION_STATE_PATH,
        updatedAt: now,
        entries: after.entries.length
    };
}

function getPartitionEntryId(entry) {
    return hashString([
        entry.sourceHost || 'unknown',
        normalizePath(entry.sourcePath || entry.file || ''),
        normalizeEntryText(entry.text)
    ].join('\n')).slice(0, 16);
}

function getLedgerStatus(entry) {
    if (entry.classification === 'cross-host') {
        return 'mirrored';
    }
    if (entry.classification === 'project-state') {
        return 'moved';
    }
    if (entry.classification === 'stale') {
        return 'removed';
    }
    return 'observed';
}

function getStateTimestamp(now) {
    const date = now instanceof Date ? now : new Date();
    return date.toISOString();
}

function isGeneratedPartitionMarker(text) {
    return /^\[(soft-harness:\s*(mirrored|moved)|Imported from [^\]]+ memory; do not reverse-merge)/iu.test(text)
        || /soft-harness:\s*imported-memory/iu.test(text);
}

function normalizeEntryText(text) {
    return String(text || '').replace(/\s+/gu, ' ').trim();
}

function previewText(text) {
    const normalized = normalizeEntryText(text);
    if (normalized.length <= 120) {
        return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
}

function normalizePath(value) {
    return String(value || '').replace(/\\/gu, '/');
}

module.exports = {
    SHARED_MEMORY_PATH,
    PROJECT_STATE_PATH,
    PARTITION_STATE_PATH,
    analyzeMemoryPartition,
    classifyMemoryEntry,
    findClaudeMemoryFiles,
    findCodexMemoryFiles,
    findHostMemoryFiles,
    parseMemoryEntries,
    runPartitionMemory,
    summarizeEntries
};
