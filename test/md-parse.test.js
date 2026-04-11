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
