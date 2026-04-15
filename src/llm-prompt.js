function parsePromptArgs(args) {
    const flags = new Set(args || []);
    if (!flags.has('--analyze')) {
        throw new Error('prompt requires --analyze');
    }

    return {
        analyze: true,
        account: flags.has('--account'),
        web: !flags.has('--no-web')
    };
}

function buildPrompt(options) {
    const scopeFlag = options && options.account ? ' --account' : '';
    const webInstruction = options && options.web
        ? [
            'When checking latest versions, prefer official release sources:',
            '- GitHub releases/tags for GitHub repositories',
            '- official marketplace/package metadata when available',
            '- npm package metadata only when the plugin is clearly distributed as an npm package',
            'Do not use arbitrary blog posts or copied package mirrors as source of truth.'
        ].join('\n')
        : [
            'Do not guess latest_version from memory.',
            'Use null unless the local packet already provides enough version/source evidence.'
        ].join('\n');

    return [
        'You are helping curate soft-harness plugin provenance.',
        '',
        'Goal:',
        '- Inspect my current LLM plugin inventory.',
        '- Infer each plugin\'s canonical origin and latest available version.',
        '- Feed the curated result back into soft-harness.',
        '- Verify the final analyze output.',
        '',
        'Rules:',
        '- Do not edit host config files directly.',
        '- Use soft-harness commands only.',
        '- Treat GitHub/source inference as probabilistic unless local metadata or official repository evidence is strong.',
        '- If a plugin source cannot be identified confidently, set source_type to "unknown", repo/url/latest_version to null, and explain why in notes.',
        '- Prefer exact plugin name, registry, author, description, local cache metadata, official marketplace metadata, npm package metadata, and GitHub repository metadata.',
        '- Do not invent repository URLs.',
        '- Return only curated entries that are supported by evidence.',
        '',
        'Steps:',
        '',
        '1. Generate the plugin research packet:',
        '```bash',
        `soft-harness analyze${scopeFlag} --category=plugins --json > plugin-research-packet.json`,
        '```',
        '',
        '2. Read `plugin-research-packet.json`.',
        '',
        '3. For each entry under `inventory.plugins.llmPacket.plugins`, infer this output schema:',
        '```json',
        JSON.stringify({
            plugin_origins: [{
                plugin: '<display_name from packet>',
                hosts: ['<host from packet>'],
                source_type: '<github|marketplace|unknown>',
                repo: '<owner/repo or null>',
                url: '<canonical source URL or null>',
                latest_version: '<latest version or null>',
                confidence: '<confirmed|llm-inferred|unknown>',
                notes: '<short evidence-based rationale>'
            }]
        }, null, 2),
        '```',
        '',
        '4. Write the result to `plugin-origins.json`.',
        '',
        '5. Import the curated result into soft-harness:',
        '```bash',
        `soft-harness curate plugins${scopeFlag} --input=plugin-origins.json`,
        '```',
        '',
        '6. Verify the final report:',
        '```bash',
        `soft-harness analyze${scopeFlag} --category=plugins --explain`,
        '```',
        '',
        '7. Report:',
        '- Which plugins were curated.',
        '- Which plugins have update available.',
        '- Which plugins remain unknown and why.',
        '- Any entries skipped due to insufficient evidence.',
        '',
        webInstruction
    ].join('\n');
}

module.exports = {
    buildPrompt,
    parsePromptArgs
};
