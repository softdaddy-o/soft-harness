const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarkdownSections } = require('../src/md-parse');

test('md-parse: empty file produces one empty section', () => {
    assert.deepEqual(parseMarkdownSections(''), [{
        heading: '',
        level: 0,
        body: '',
        raw: ''
    }]);
});

test('md-parse: file without headings stays whole', () => {
    const sections = parseMarkdownSections('plain text');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].body, 'plain text');
});

test('md-parse: parent section includes nested subsection content', () => {
    const sections = parseMarkdownSections('## Parent\nline\n### Child\nmore\n## Next\nend');
    assert.equal(sections.length, 3);
    assert.match(sections[0].body, /### Child/);
    assert.equal(sections[1].heading, 'Child');
    assert.equal(sections[2].heading, 'Next');
});

test('md-parse: fenced code block comments do not become headings', () => {
    const sections = parseMarkdownSections([
        '## Build/Run Commands',
        '### p4-plan-converter',
        '```bash',
        '# Install dependencies',
        'npm install',
        '```',
        '### social-posting',
        'done'
    ].join('\n'));

    assert.equal(sections.length, 3);
    assert.equal(sections[0].heading, 'Build/Run Commands');
    assert.equal(sections[1].heading, 'p4-plan-converter');
    assert.equal(sections[2].heading, 'social-posting');
    assert.doesNotMatch(sections.map((section) => section.heading).join('\n'), /Install dependencies/);
});

test('md-parse: tilde fences and unclosed fences suppress heading parsing until closed', () => {
    const sections = parseMarkdownSections([
        '## Parent',
        '~~~yaml',
        '# fake heading',
        'key: value',
        '### still fake',
        '~~~',
        '## Next',
        '~~~bash',
        '# remains inside unclosed fence'
    ].join('\n'));

    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, 'Parent');
    assert.equal(sections[1].heading, 'Next');
    assert.doesNotMatch(sections.map((section) => section.heading).join('\n'), /fake|still fake/i);
});
