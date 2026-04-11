#!/usr/bin/env node
/**
 * Scenario eval runner (Type A)
 * Reads evals.json for a skill, sends each prompt to Claude API,
 * and checks assertions against the response.
 *
 * Usage: node .claude/skills/eval-scenario.js <skill-name> [--eval-id N]
 *
 * Requires: ANTHROPIC_API_KEY env var
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SKILLS_DIR = path.join(__dirname);
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

// ── Helpers ───────────────────────────────────────────────────────────

function callClaude(systemPrompt, userPrompt) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            reject(new Error('ANTHROPIC_API_KEY not set'));
            return;
        }

        const body = JSON.stringify({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
        });

        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message));
                        return;
                    }
                    const text = parsed.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n');
                    resolve(text);
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}\nRaw: ${data.substring(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function checkAssertion(assertion, response) {
    const resp = response.toLowerCase();
    const result = { text: assertion.text, type: assertion.type, passed: false, detail: '' };

    switch (assertion.type) {
        case 'contains':
            result.passed = response.includes(assertion.value);
            result.detail = result.passed ? 'Found' : `"${assertion.value}" not found`;
            break;
        case 'negative_contains':
            result.passed = !response.includes(assertion.value);
            result.detail = result.passed ? 'Correctly absent' : `"${assertion.value}" should not be present`;
            break;
        case 'contains_all':
            const missing = (assertion.values || []).filter(v => !response.includes(v));
            result.passed = missing.length === 0;
            result.detail = result.passed ? 'All found' : `Missing: ${missing.join(', ')}`;
            break;
        case 'regex_match':
            result.passed = new RegExp(assertion.pattern).test(response);
            result.detail = result.passed ? 'Pattern matched' : `Pattern /${assertion.pattern}/ not found`;
            break;
        case 'negative_regex':
            result.passed = !new RegExp(assertion.pattern).test(response);
            result.detail = result.passed ? 'Correctly no match' : `Pattern /${assertion.pattern}/ should not match`;
            break;
        case 'min_count': {
            const matches = response.match(new RegExp(assertion.pattern, 'g')) || [];
            result.passed = matches.length >= assertion.min;
            result.detail = `Found ${matches.length}, need >= ${assertion.min}`;
            break;
        }
        case 'output_check':
        case 'behavior_check':
        case 'tool_call_check':
        case 'negative_check':
            // These require manual or AI-judge evaluation
            // For automated runs, mark as "needs review"
            result.passed = null; // null = inconclusive
            result.detail = `Manual check: ${assertion.check || assertion.description || ''}`;
            break;
        case 'manual_check':
        case 'negative_order':
            result.passed = null;
            result.detail = `Manual: ${assertion.description || ''}`;
            break;
        default:
            result.passed = null;
            result.detail = `Unknown assertion type: ${assertion.type}`;
    }
    return result;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
    const skillName = process.argv[2];
    if (!skillName) {
        console.error('Usage: node eval-scenario.js <skill-name> [--eval-id N]');
        process.exit(1);
    }

    const evalIdFlag = process.argv.indexOf('--eval-id');
    const filterEvalId = evalIdFlag >= 0 ? parseInt(process.argv[evalIdFlag + 1]) : null;

    const evalsPath = path.join(SKILLS_DIR, skillName, 'evals', 'evals.json');
    if (!fs.existsSync(evalsPath)) {
        console.error(`No evals found at ${evalsPath}`);
        process.exit(1);
    }

    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    const skillContent = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf-8') : '';

    const evalsData = JSON.parse(fs.readFileSync(evalsPath, 'utf-8'));
    let evals = evalsData.evals;

    if (filterEvalId !== null) {
        evals = evals.filter(e => e.id === filterEvalId);
    }

    console.log(`\n🧪 Scenario Eval: ${skillName} (${evals.length} tests)\n`);

    let passed = 0;
    let failed = 0;
    let inconclusive = 0;

    for (const evalCase of evals) {
        console.log(`── Eval #${evalCase.id}: ${evalCase.prompt.substring(0, 60)}...`);

        try {
            const systemPrompt = `You are an AI assistant following these skill instructions:\n\n${skillContent}\n\nDescribe what actions you would take to handle the user's request. Include tool calls you would make, their parameters, and output you would produce. Be specific about page names, headers, and content.`;

            const response = await callClaude(systemPrompt, evalCase.prompt);
            console.log(`   Response: ${response.substring(0, 120)}...`);

            for (const assertion of evalCase.assertions) {
                const result = checkAssertion(assertion, response);
                if (result.passed === true) {
                    console.log(`   ✅ ${result.text}`);
                    passed++;
                } else if (result.passed === false) {
                    console.log(`   ❌ ${result.text}: ${result.detail}`);
                    failed++;
                } else {
                    console.log(`   🔍 ${result.text}: ${result.detail}`);
                    inconclusive++;
                }
            }
        } catch (err) {
            console.log(`   ⚠️  API Error: ${err.message}`);
            failed += evalCase.assertions.length;
        }
        console.log();
    }

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}  🔍 Manual: ${inconclusive}`);
    if (failed > 0) process.exit(1);
}

main();
