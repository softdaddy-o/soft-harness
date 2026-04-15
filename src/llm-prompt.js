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
            'Use your available web search/browser tools for this workflow.',
            'Search the web for each unresolved or weakly-evidenced plugin, skill, or agent origin before deciding it is unknown.',
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
        'You are helping resolve soft-harness origins.',
        '',
        'Goal:',
        '- Complete the full origin workflow yourself.',
        '- Inspect my current LLM plugin, skill, and agent inventory.',
        '- Find GitHub repositories and official marketplace pages for installed plugins, skills, and expert agents.',
        '- Detect installed and latest available versions when reliable sources exist.',
        '- Save the found origin data back into soft-harness.',
        '- Verify the final analyze output.',
        '',
        'Rules:',
        '- Run the commands yourself. Do not ask the user to run follow-up commands.',
        '- Do not edit host config files directly.',
        '- Use soft-harness commands only.',
        '- It is safe before first sync: origin import commands can create `.harness/plugin-origins.yaml` and `.harness/asset-origins.yaml` by themselves.',
        '- Do not run `soft-harness sync` unless the user explicitly asks you to propagate harness truth into host-native files.',
        '- Treat GitHub/source inference as probabilistic unless local metadata or official repository evidence is strong.',
        '- If a source cannot be identified confidently, set source_type to "unknown", repo/url/latest_version to null, and explain why in notes.',
        '- Prefer exact plugin name, registry, author, description, local cache metadata, official marketplace metadata, npm package metadata, and GitHub repository metadata.',
        '- For skills and expert agents, prefer local .git metadata, README/package metadata, exact agent or skill names, and official GitHub repository evidence.',
        '- Do not stop at local metadata. Local metadata is only a shortcut for confirmed entries; unknown skills and expert agents still require GitHub/web search.',
        '- Use `search_hints` from asset entries as the first GitHub/web search queries.',
        '- Do not invent repository URLs.',
        '- Save only entries that are supported by evidence.',
        '',
        'Steps:',
        '',
        '1. Generate the research packets:',
        '```bash',
        `soft-harness analyze${scopeFlag} --category=plugins --json > plugin-research-packet.json`,
        `soft-harness analyze${scopeFlag} --category=skills --json > asset-research-packet.json`,
        '```',
        '',
        '2. Read `plugin-research-packet.json` and `asset-research-packet.json`.',
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
        '4. For each entry under `inventory.skillOrigins.llmPacket.assets`, infer this output schema:',
        '- First handle entries where `needs_origin_research` is true.',
        '- For each unresolved skill or agent, run GitHub/web searches using `search_hints` plus exact filename/name queries.',
        '- Prefer GitHub repositories that contain the exact skill directory, `SKILL.md`, or agent `.md` filename.',
        '- If several repositories copy the same asset, prefer the upstream repo with releases/tags, README ownership evidence, or the earliest authoritative source.',
        '```json',
        JSON.stringify({
            asset_origins: [{
                kind: '<skill|agent>',
                asset: '<name from packet>',
                hosts: ['<host from packet>'],
                source_type: '<github|marketplace|local|unknown>',
                repo: '<owner/repo or null>',
                url: '<canonical source URL or null>',
                source_path: '<path inside repo or null>',
                installed_version: '<installed version or null>',
                latest_version: '<latest version or null>',
                git_commit_sha: '<installed git commit or null>',
                confidence: '<confirmed|llm-inferred|unknown>',
                notes: '<short evidence-based rationale>'
            }]
        }, null, 2),
        '```',
        '',
        '5. Write the results to `plugin-origins.json` and `asset-origins.json`.',
        '',
        '6. Save the found origins into soft-harness:',
        '```bash',
        `soft-harness plugins import-origins${scopeFlag} --input=plugin-origins.json`,
        `soft-harness origins import${scopeFlag} --input=asset-origins.json`,
        '```',
        '',
        '7. Verify the final reports:',
        '```bash',
        `soft-harness analyze${scopeFlag} --category=plugins --explain`,
        `soft-harness analyze${scopeFlag} --category=skills --explain`,
        '```',
        '',
        '8. Report:',
        '- Which plugin origins were found.',
        '- Which skill and agent origins were found, especially GitHub-installed expert agents and tools such as gstack.',
        '- Which plugins have update available.',
        '- Which skills or agents have update evidence available.',
        '- Which entries remain unknown and why.',
        '- Any entries skipped due to insufficient evidence.',
        '',
        webInstruction
    ].join('\n');
}

module.exports = {
    buildPrompt,
    parsePromptArgs
};
