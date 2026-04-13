const path = require('node:path');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');
const { extractInstructionBuckets } = require('./extract');
const { parseMarkdownSections } = require('./md-parse');
const { confirm } = require('./prompt');

async function importInstructions(rootDir, discovered, options) {
    const harnessDir = path.join(rootDir, '.harness');
    const llmDir = path.join(harnessDir, 'llm');
    ensureDir(llmDir);

    const harnessPath = path.join(harnessDir, 'HARNESS.md');
    const imported = [];
    const writes = [];
    const routes = [];

    if (discovered.length === 0) {
        if (!exists(harnessPath)) {
            writes.push({ path: '.harness/HARNESS.md', content: '' });
            if (!options || !options.dryRun) {
                writeUtf8(harnessPath, '');
            }
        }
        return {
            imported,
            routes,
            writes
        };
    }

    const hasExistingHarness = !options.firstSync
        && (exists(harnessPath) || discovered.some((entry) => exists(path.join(llmDir, `${entry.llm}.md`))));
    if (!hasExistingHarness) {
        const adopted = [];
        for (const entry of discovered) {
            if (!(await shouldAdoptInstruction(entry, options))) {
                continue;
            }
            adopted.push(entry);
        }

        const activeDiscovered = adopted;
        const buckets = extractInstructionBuckets(activeDiscovered.map((entry) => ({
            llm: entry.llm,
            content: readUtf8(entry.absolutePath)
        })));

        const selectedCommonSections = await selectCommonSections(buckets, activeDiscovered, options);
        const renderedBuckets = renderSelectedBuckets(buckets, selectedCommonSections);

        writeMaybe(rootDir, '.harness/HARNESS.md', renderedBuckets.commonContent, writes, options);
        for (const entry of activeDiscovered) {
            writeMaybe(rootDir, `.harness/llm/${entry.llm}.md`, renderedBuckets.llmContents[entry.llm] || '', writes, options);
            imported.push({
                llm: entry.llm,
                from: entry.relativePath,
                to: `.harness/llm/${entry.llm}.md`
            });
            routes.push({
                action: 'adopt',
                from: entry.relativePath,
                llm: entry.llm,
                to: `.harness/llm/${entry.llm}.md`
            });
            routes.push({
                action: 'adopt-plan',
                from: entry.relativePath,
                llm: entry.llm,
                to: `.harness/llm/${entry.llm}.md`,
                sections: buildSectionPlan(readUtf8(entry.absolutePath), entry.llm, buckets.maybeSections)
            });
        }

        for (const section of renderedBuckets.commonSections) {
            routes.push({
                action: 'extract-common',
                heading: section.heading,
                from: activeDiscovered.map((entry) => entry.relativePath),
                to: '.harness/HARNESS.md'
            });
        }

        for (const entry of activeDiscovered) {
            const sections = renderedBuckets.llmSections[entry.llm] || [];
            for (const section of sections) {
                routes.push({
                    action: 'extract-specific',
                    heading: section.heading,
                    from: entry.relativePath,
                    llm: entry.llm,
                    to: `.harness/llm/${entry.llm}.md`
                });
            }
        }

        for (const section of buckets.maybeSections) {
            routes.push({
                action: 'maybe-common',
                heading: section.heading,
                llms: section.llms,
                similarity: section.similarity
            });
        }
        return {
            imported,
            routes,
            writes,
            maybeSections: buckets.maybeSections
        };
    }

    if (!exists(harnessPath)) {
        writeMaybe(rootDir, '.harness/HARNESS.md', '', writes, options);
    }

    for (const entry of discovered) {
        const targetPath = `.harness/llm/${entry.llm}.md`;
        if (exists(path.join(rootDir, targetPath))) {
            continue;
        }
        writeMaybe(rootDir, targetPath, readUtf8(entry.absolutePath), writes, options);
        imported.push({
            llm: entry.llm,
            from: entry.relativePath,
            to: targetPath
        });
        routes.push({
            action: 'adopt',
            from: entry.relativePath,
            llm: entry.llm,
            to: targetPath
        });
    }

    return {
        imported,
        routes,
        writes,
        maybeSections: []
    };
}

function writeMaybe(rootDir, relativePath, content, writes, options) {
    writes.push({
        path: relativePath,
        content
    });
    if (!options || !options.dryRun) {
        writeUtf8(path.join(rootDir, relativePath), content);
    }
}

module.exports = {
    importInstructions
};

function buildSectionPlan(content, llm, maybeSections) {
    return parseMarkdownSections(content).map((section) => {
        const nearMatch = (maybeSections || []).find((item) => item.heading === section.heading && item.llms.includes(llm));
        const otherLlms = nearMatch
            ? nearMatch.llms.filter((name) => name !== llm)
            : [];
        return {
            heading: section.heading,
            level: section.level,
            nearMatch: nearMatch
                ? {
                    similarity: nearMatch.similarity,
                    otherLlms
                }
                : null
        };
    });
}

async function shouldAdoptInstruction(entry, options) {
    if (!options || !options.reviewImports) {
        return true;
    }

    if (options.yes) {
        return true;
    }

    return confirm(`Adopt ${entry.relativePath} into .harness/llm/${entry.llm}.md?`, options);
}

async function selectCommonSections(buckets, discovered, options) {
    const selected = new Set();

    for (let index = 0; index < buckets.commonSections.length; index += 1) {
        const section = buckets.commonSections[index];
        if (!options || !options.reviewImports || options.yes) {
            selected.add(index);
            continue;
        }

        const sources = discovered.map((entry) => entry.relativePath).join(', ');
        const answer = await confirm(`Promote section "${section.heading || '(untitled)'}" from ${sources} into .harness/HARNESS.md?`, options);
        if (answer) {
            selected.add(index);
        }
    }

    return selected;
}

function renderSelectedBuckets(buckets, selectedCommonSections) {
    const commonSections = [];
    const llmSections = {};
    const rejectedCommonKeys = new Set();

    for (let index = 0; index < buckets.commonSections.length; index += 1) {
        const section = buckets.commonSections[index];
        if (selectedCommonSections.has(index)) {
            commonSections.push(section);
            continue;
        }
        rejectedCommonKeys.add(`${section.heading}\n${section.raw}`);
    }

    for (const [llm, sections] of Object.entries(buckets.allSectionsByLlm || {})) {
        llmSections[llm] = sections.filter((section) => {
            if (!hasSection(buckets.commonSections, section)) {
                return true;
            }
            return rejectedCommonKeys.has(`${section.heading}\n${section.raw}`);
        });
    }

    return {
        commonSections,
        commonContent: renderSections(commonSections),
        llmSections,
        llmContents: Object.fromEntries(Object.entries(llmSections).map(([llm, sections]) => [llm, renderSections(sections)]))
    };
}

function renderSections(sections) {
    return sections.map((section) => section.raw.trim()).filter(Boolean).join('\n\n').trim();
}

function hasSection(sections, targetSection) {
    return (sections || []).some((section) => section.heading === targetSection.heading
        && section.raw === targetSection.raw);
}
