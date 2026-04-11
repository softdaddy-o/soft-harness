#!/usr/bin/env node
/**
 * Static SKILL.md validator (Type B eval)
 * Parses SKILL.md files and checks for internal consistency.
 *
 * Usage: node .claude/skills/eval-static.js [skill-name]
 *   No args → validate all skills
 *   skill-name → validate specific skill only
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname);
let passed = 0;
let failed = 0;
const errors = [];

function fail(skill, rule, detail) {
    failed++;
    errors.push({ skill, rule, detail });
    console.log(`  ❌ ${rule}: ${detail}`);
}

function pass(rule) {
    passed++;
    console.log(`  ✅ ${rule}`);
}

// ── Rule definitions ──────────────────────────────────────────────────

const rules = [
    {
        name: 'frontmatter-required-fields',
        description: 'SKILL.md must have name, description, allowed-tools in frontmatter',
        check(skill, content, frontmatter) {
            const required = ['name', 'description', 'allowed-tools'];
            for (const field of required) {
                if (!frontmatter[field]) {
                    fail(skill, this.name, `Missing frontmatter field: ${field}`);
                    return;
                }
            }
            pass(this.name);
        }
    },
    {
        name: 'no-deprecated-journal-report',
        description: 'No references to writing Auto-Post Report to journal (deprecated)',
        check(skill, content) {
            // Only check schedule-threads and daily-start
            if (!['schedule-threads', 'daily-start'].includes(skill)) {
                pass(this.name + ' (skipped)');
                return;
            }
            const deprecatedPatterns = [
                /journal.*Auto-Post Report/i,
                /append_to_page.*journal.*📤/i,
                /저널.*Auto-Post Report/i,
            ];
            for (const pat of deprecatedPatterns) {
                if (pat.test(content)) {
                    fail(skill, this.name, `Found deprecated pattern: ${pat}`);
                    return;
                }
            }
            pass(this.name);
        }
    },
    {
        name: 'report-goes-to-tq',
        description: 'schedule-threads must write report to TQ page, not journal',
        check(skill, content) {
            if (skill !== 'schedule-threads') {
                pass(this.name + ' (skipped)');
                return;
            }
            if (!content.includes('📤 예약 결과')) {
                fail(skill, this.name, 'Missing "📤 예약 결과" section — report must go to TQ page');
                return;
            }
            if (content.includes('📤 Threads Auto-Post Report')) {
                fail(skill, this.name, 'Still references deprecated "📤 Threads Auto-Post Report" header');
                return;
            }
            pass(this.name);
        }
    },
    {
        name: 'dedup-check-uses-tq',
        description: 'schedule-threads cron dedup must check TQ page, not journal',
        check(skill, content) {
            if (skill !== 'schedule-threads') {
                pass(this.name + ' (skipped)');
                return;
            }
            if (content.includes('journal-based, secondary check')) {
                fail(skill, this.name, 'Dedup check still references journal-based check');
                return;
            }
            if (!content.includes('TQ page') && !content.includes('TQ 페이지')) {
                fail(skill, this.name, 'Dedup check does not mention TQ page');
                return;
            }
            pass(this.name);
        }
    },
    {
        name: 'no-slash-in-page-names',
        description: 'Page names must use underscore prefix, not slash',
        check(skill, content) {
            // Check for create_page or read_page with slash-based names
            const slashPagePattern = /(?:create_page|read_page)\s*\(\s*["'](?:SR|ZK|TQ)\//;
            if (slashPagePattern.test(content)) {
                fail(skill, this.name, 'Found slash-based page name in API call');
                return;
            }
            pass(this.name);
        }
    },
    {
        name: 'allowed-tools-match-usage',
        description: 'Tools used in SKILL.md body should be in allowed-tools',
        check(skill, content, frontmatter) {
            const allowedTools = (frontmatter['allowed-tools'] || '').split(',').map(t => t.trim());
            const mcpToolPattern = /mcp__\w+__\w+/g;
            const usedMcpTools = [...new Set((content.match(mcpToolPattern) || []))];

            const missing = [];
            for (const tool of usedMcpTools) {
                if (!allowedTools.some(a => a === tool || tool.startsWith(a))) {
                    missing.push(tool);
                }
            }
            if (missing.length > 0) {
                fail(skill, this.name, `MCP tools used but not in allowed-tools: ${missing.join(', ')}`);
                return;
            }
            pass(this.name);
        }
    },
    {
        name: 'evals-json-valid',
        description: 'evals/evals.json must be valid JSON with required fields',
        check(skill, content) {
            const evalsPath = path.join(SKILLS_DIR, skill, 'evals', 'evals.json');
            if (!fs.existsSync(evalsPath)) {
                pass(this.name + ' (no evals file)');
                return;
            }
            try {
                const evals = JSON.parse(fs.readFileSync(evalsPath, 'utf-8'));
                if (!Array.isArray(evals.evals)) {
                    fail(skill, this.name, 'evals.json missing "evals" array');
                    return;
                }
                for (const e of evals.evals) {
                    if (!e.id || !e.prompt || !e.assertions) {
                        fail(skill, this.name, `Eval #${e.id || '?'} missing required fields (id, prompt, assertions)`);
                        return;
                    }
                }
                pass(this.name);
            } catch (err) {
                fail(skill, this.name, `Invalid JSON: ${err.message}`);
            }
        }
    },
    {
        name: 'tq-description-includes-report',
        description: 'daily-start TQ table row should mention report',
        check(skill, content) {
            if (skill !== 'daily-start') {
                pass(this.name + ' (skipped)');
                return;
            }
            if (!content.includes('포스팅 큐 + 예약 결과')) {
                fail(skill, this.name, 'TQ table row missing "예약 결과" description');
                return;
            }
            pass(this.name);
        }
    },
];

// ── Runner ────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
    const fm = {};
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return fm;
    for (const line of match[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            fm[line.substring(0, colonIdx).trim()] = line.substring(colonIdx + 1).trim();
        }
    }
    return fm;
}

function validateSkill(skillName) {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
        console.log(`⚠️  ${skillName}: SKILL.md not found, skipping`);
        return;
    }

    console.log(`\n📋 ${skillName}`);
    const content = fs.readFileSync(skillPath, 'utf-8');
    const frontmatter = parseFrontmatter(content);

    for (const rule of rules) {
        rule.check(skillName, content, frontmatter);
    }
}

// ── Main ──────────────────────────────────────────────────────────────

const targetSkill = process.argv[2];

if (targetSkill) {
    validateSkill(targetSkill);
} else {
    const skills = fs.readdirSync(SKILLS_DIR).filter(d => {
        const p = path.join(SKILLS_DIR, d);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'SKILL.md'));
    });
    for (const skill of skills) {
        validateSkill(skill);
    }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}`);
if (errors.length > 0) {
    console.log(`\nFailures:`);
    for (const e of errors) {
        console.log(`  ${e.skill} → ${e.rule}: ${e.detail}`);
    }
    process.exit(1);
}
