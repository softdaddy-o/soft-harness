const path = require('node:path');
const { createBackup } = require('./backup');
const { buildInstructionState, exportInstructions } = require('./export');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');
const { normalizeContent, normalizeHeadingText, parseMarkdownSections } = require('./md-parse');
const { getProfile, listProfiles } = require('./profiles');
const { getDefaultState, loadState, saveState } = require('./state');

const DEFAULT_SECTION = 'Recorded Memory';

function parseRememberArgs(args) {
    const scopeArg = args.find((arg) => arg.startsWith('--scope='));
    const llmArg = args.find((arg) => arg.startsWith('--llm='));
    const titleArg = args.find((arg) => arg.startsWith('--title='));
    const sectionArg = args.find((arg) => arg.startsWith('--section='));
    const contentArg = args.find((arg) => arg.startsWith('--content='));
    const flags = new Set(args);

    const scope = scopeArg ? scopeArg.split('=')[1] : 'project';
    if (!['project', 'account'].includes(scope)) {
        throw new Error(`invalid --scope: ${scope}`);
    }

    const llm = llmArg ? llmArg.split('=')[1] : 'shared';
    if (llm !== 'shared' && !listProfiles().includes(llm)) {
        throw new Error(`unknown --llm target: ${llm}`);
    }

    const title = titleArg ? titleArg.slice('--title='.length).trim() : '';
    if (!title) {
        throw new Error('remember requires --title');
    }

    const content = contentArg ? contentArg.slice('--content='.length).trim() : '';
    if (!content) {
        throw new Error('remember requires --content');
    }

    return {
        content,
        llm,
        noExport: flags.has('--no-export'),
        scope,
        section: sectionArg ? sectionArg.slice('--section='.length).trim() || DEFAULT_SECTION : DEFAULT_SECTION,
        title
    };
}

function runRemember(rootDir, options) {
    const rememberRoot = resolveRememberRoot(rootDir, options);
    const target = resolveRememberTarget(options.llm);
    const sourcePath = path.join(rememberRoot, target.source);
    ensureDir(path.dirname(sourcePath));

    const before = exists(sourcePath) ? readUtf8(sourcePath) : '';
    const after = upsertMemoryEntry(before, {
        section: options.section,
        title: options.title,
        content: options.content
    });

    const backupTargets = [
        target.source,
        ...target.outputs
    ];
    const backup = createBackup(rememberRoot, backupTargets, { reason: 'remember' });

    writeUtf8(sourcePath, after);

    const state = loadState(rememberRoot);
    const exportResult = options.noExport
        ? { exported: [], routes: [] }
        : exportInstructions(rememberRoot, { state });

    if (!options.noExport) {
        saveState(rememberRoot, {
            ...state,
            assets: {
                ...getDefaultState().assets,
                ...state.assets,
                instructions: buildInstructionState(rememberRoot, state)
            }
        });
    }

    return {
        backupTs: backup ? backup.timestamp : null,
        changed: before !== after,
        exports: exportResult.exported,
        outputRoot: rememberRoot,
        routes: exportResult.routes || [],
        section: options.section,
        source: target.source,
        scope: options.scope,
        title: options.title,
        target: options.llm
    };
}

function resolveRememberRoot(rootDir, options) {
    if ((options && options.scope) !== 'account') {
        return rootDir;
    }
    const homeDir = options.homeDir || process.env.USERPROFILE || process.env.HOME;
    if (!homeDir) {
        throw new Error('account scope requires HOME or USERPROFILE');
    }
    return path.resolve(homeDir);
}

function resolveRememberTarget(target) {
    if (target === 'shared') {
        return {
            source: '.harness/HARNESS.md',
            outputs: listProfiles().flatMap((name) => getProfile(name).instruction_files)
        };
    }

    return {
        source: `.harness/llm/${target}.md`,
        outputs: getProfile(target).instruction_files
    };
}

function upsertMemoryEntry(content, options) {
    const normalized = normalizeContent(content || '').trim();
    const sectionHeading = normalizeHeadingText(options.section || DEFAULT_SECTION);
    const entryHeading = normalizeHeadingText(options.title || '');
    const entryRaw = [
        `### ${entryHeading}`,
        '',
        normalizeContent(options.content || '').trim()
    ].join('\n').trim();
    const newSectionRaw = [
        `## ${sectionHeading}`,
        '',
        entryRaw
    ].join('\n').trim();

    if (!normalized) {
        return `${newSectionRaw}\n`;
    }

    const sections = parseMarkdownSections(normalized);
    const targetSection = sections.find((section) => section.level === 2 && normalizeHeadingText(section.heading) === sectionHeading);
    if (!targetSection) {
        return `${normalized}\n\n${newSectionRaw}\n`;
    }

    const nested = parseMarkdownSections(targetSection.raw);
    const existingEntry = nested.find((section) => section.level === 3 && normalizeHeadingText(section.heading) === entryHeading);
    const nextSectionRaw = existingEntry
        ? targetSection.raw.replace(existingEntry.raw, entryRaw)
        : `${targetSection.raw.trim()}\n\n${entryRaw}`;

    return `${normalized.replace(targetSection.raw, nextSectionRaw).trim()}\n`;
}

module.exports = {
    DEFAULT_SECTION,
    parseRememberArgs,
    resolveRememberRoot,
    resolveRememberTarget,
    runRemember,
    upsertMemoryEntry
};
