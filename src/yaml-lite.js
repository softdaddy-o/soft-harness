// A deliberately narrow YAML reader/writer for the subset soft-harness actually
// uses, so `src/` carries no runtime dependency and can ship inside the Claude
// plugin (the plugin cache is a copied directory with no node_modules above it).
//
// See docs/yaml-dependency-removal.md for the grammar and the decisions, and
// docs/yaml-lite-implementation.md for the build order.
//
// Read/write asymmetry is intentional and load-bearing:
//   - the writer never folds, never emits flow style, never emits block scalars
//   - the reader still accepts folded double-quoted scalars, `|` blocks, and
//     flow sequences, because files already on disk contain them
// Do not "simplify" the reader down to what the writer emits.

class ParseError extends Error {
    constructor(message, { filename, line, construct } = {}) {
        const where = `${filename || '<yaml>'}:${line == null ? '?' : line}`;
        super(`${where}: ${message}`);
        this.name = 'ParseError';
        this.filename = filename || null;
        this.line = line == null ? null : line;
        this.construct = construct || null;
    }
}

const INDICATORS = '-?:,[]{}#&*!|>\'"%@`';

function parse(text, options = {}) {
    const filename = (options && options.filename) || null;
    let source = String(text == null ? '' : text);
    if (source.charCodeAt(0) === 0xfeff) {
        source = source.slice(1);
    }
    source = source.replace(/\r\n?/g, '\n');

    const lines = source.split('\n').map((raw, index) => ({ raw, no: index + 1 }));
    const ctx = { filename, lines, index: 0, seenDocStart: false, contentStarted: false };

    skipIgnorable(ctx);
    if (ctx.index >= ctx.lines.length) {
        return null;
    }

    ctx.contentStarted = true;

    // A document that is nothing but an empty collection. The writer emits
    // these for an empty root value, so the reader has to accept them.
    const first = ctx.lines[ctx.index].raw.trim();
    if (first === '[]' || first === '{}') {
        ctx.index += 1;
        skipIgnorable(ctx);
        if (ctx.index < ctx.lines.length) {
            throw new ParseError('unexpected content after the document', {
                filename,
                line: ctx.lines[ctx.index].no,
                construct: 'trailing-content'
            });
        }
        return first === '[]' ? [] : {};
    }

    const value = parseNode(ctx, indentOf(ctx, ctx.lines[ctx.index]));

    skipIgnorable(ctx);
    if (ctx.index < ctx.lines.length) {
        throw new ParseError('unexpected content after the document', {
            filename,
            line: ctx.lines[ctx.index].no,
            construct: 'trailing-content'
        });
    }
    return value;
}

function skipIgnorable(ctx) {
    while (ctx.index < ctx.lines.length) {
        const line = ctx.lines[ctx.index];
        const trimmed = line.raw.trim();
        if (trimmed === '') {
            ctx.index += 1;
            continue;
        }
        if (trimmed.startsWith('#')) {
            ctx.index += 1;
            continue;
        }
        if (trimmed === '---') {
            // A single leading `---` is a document start and is tolerated. One
            // that appears after content has begun is a document separator.
            if (ctx.seenDocStart || ctx.contentStarted) {
                throw new ParseError('multi-document streams are not supported', {
                    filename: ctx.filename,
                    line: line.no,
                    construct: 'multi-document'
                });
            }
            ctx.seenDocStart = true;
            ctx.index += 1;
            continue;
        }
        if (trimmed === '...') {
            throw new ParseError('multi-document streams are not supported', {
                filename: ctx.filename,
                line: line.no,
                construct: 'multi-document'
            });
        }
        return;
    }
}

function indentOf(ctx, line) {
    const match = /^[ \t]*/.exec(line.raw)[0];
    if (match.includes('\t')) {
        throw new ParseError('tab characters cannot be used for indentation', {
            filename: ctx.filename,
            line: line.no,
            construct: 'tab-indent'
        });
    }
    return match.length;
}

function parseNode(ctx, indent) {
    const line = ctx.lines[ctx.index];
    const trimmed = line.raw.trim();
    if (trimmed.startsWith('- ') || trimmed === '-') {
        return parseSequence(ctx, indent);
    }
    return parseMapping(ctx, indent);
}

function parseMapping(ctx, indent) {
    const result = {};
    const seen = new Set();

    while (true) {
        skipIgnorable(ctx);
        if (ctx.index >= ctx.lines.length) {
            break;
        }
        const line = ctx.lines[ctx.index];
        const lineIndent = indentOf(ctx, line);
        if (lineIndent < indent) {
            break;
        }
        if (lineIndent > indent) {
            throw new ParseError('unexpected indentation', {
                filename: ctx.filename,
                line: line.no,
                construct: 'indent'
            });
        }

        const rest = line.raw.slice(indent);
        if (rest.startsWith('- ') || rest.trim() === '-') {
            break;
        }

        const split = splitKey(rest);
        if (!split) {
            throw new ParseError(`expected "key: value" but found ${JSON.stringify(rest.trim())}`, {
                filename: ctx.filename,
                line: line.no,
                construct: 'mapping-entry'
            });
        }
        if (split.key === '?') {
            throw new ParseError('complex mapping keys are not supported', {
                filename: ctx.filename,
                line: line.no,
                construct: 'complex-key'
            });
        }
        if (seen.has(split.key)) {
            throw new ParseError(`duplicate key ${JSON.stringify(split.key)}`, {
                filename: ctx.filename,
                line: line.no,
                construct: 'duplicate-key'
            });
        }
        seen.add(split.key);

        ctx.index += 1;
        const parsed = parseValue(ctx, indent, split.value, line);
        // `__proto__` (and friends) would be swallowed by ordinary assignment,
        // losing the author's key rather than storing it.
        Object.defineProperty(result, split.key, {
            value: parsed,
            writable: true,
            enumerable: true,
            configurable: true
        });
    }

    return result;
}

function parseSequence(ctx, indent) {
    const result = [];

    while (true) {
        skipIgnorable(ctx);
        if (ctx.index >= ctx.lines.length) {
            break;
        }
        const line = ctx.lines[ctx.index];
        const lineIndent = indentOf(ctx, line);
        if (lineIndent < indent) {
            break;
        }
        if (lineIndent > indent) {
            throw new ParseError('unexpected indentation', {
                filename: ctx.filename,
                line: line.no,
                construct: 'indent'
            });
        }

        const rest = line.raw.slice(indent);
        if (!rest.startsWith('- ') && rest.trim() !== '-') {
            break;
        }

        const inline = rest.trim() === '-' ? '' : rest.slice(2);
        if (inline.trim() === '') {
            ctx.index += 1;
            result.push(parseValue(ctx, indent, '', line));
            continue;
        }

        // A sequence item that is itself a mapping or a nested sequence starts
        // on the `- ` line. Rewrite the dash as spaces so the block parser sees
        // a normal block at indent + 2 and consumes the item's later lines.
        if (splitKey(inline)) {
            ctx.lines[ctx.index] = {
                raw: `${' '.repeat(indent + 2)}${inline}`,
                no: line.no
            };
            result.push(parseMapping(ctx, indent + 2));
            continue;
        }
        if (inline.startsWith('- ') || inline.trim() === '-') {
            ctx.lines[ctx.index] = {
                raw: `${' '.repeat(indent + 2)}${inline}`,
                no: line.no
            };
            result.push(parseSequence(ctx, indent + 2));
            continue;
        }

        ctx.index += 1;
        result.push(scalar(ctx, inline, line));
    }

    return result;
}

// Splits `key: value` while ignoring a colon inside quotes or brackets.
function splitKey(text) {
    let quote = null;
    let depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\' && quote === '"') {
                i += 1;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '[' || ch === '{') {
            depth += 1;
            continue;
        }
        if (ch === ']' || ch === '}') {
            depth -= 1;
            continue;
        }
        if (ch === ':' && depth === 0) {
            const next = text[i + 1];
            if (next === undefined || next === ' ') {
                const key = text.slice(0, i).trim();
                if (!key) {
                    return null;
                }
                return { key: unquoteKey(key), value: text.slice(i + 1).trim() };
            }
        }
    }
    return null;
}

function unquoteKey(key) {
    if (key.length >= 2 && ((key[0] === '"' && key.endsWith('"')) || (key[0] === "'" && key.endsWith("'")))) {
        return key.slice(1, -1);
    }
    return key;
}

function parseValue(ctx, parentIndent, inlineText, keyLine) {
    const text = stripComment(inlineText);

    if (text === '') {
        // Value lives on the following, more indented lines, or is null.
        skipIgnorable(ctx);
        if (ctx.index < ctx.lines.length) {
            const next = ctx.lines[ctx.index];
            const nextIndent = indentOf(ctx, next);
            if (nextIndent > parentIndent) {
                return parseNode(ctx, nextIndent);
            }
            // A sibling sequence may sit at the parent's own indent:
            //   llms:
            //   - claude
            const rest = next.raw.slice(nextIndent);
            if (nextIndent === parentIndent && (rest.startsWith('- ') || rest.trim() === '-')) {
                return parseSequence(ctx, nextIndent);
            }
        }
        return null;
    }

    if (text[0] === '&' || text[0] === '*') {
        throw new ParseError('anchors and aliases are not supported', {
            filename: ctx.filename,
            line: keyLine.no,
            construct: text[0] === '&' ? 'anchor' : 'alias'
        });
    }
    if (text.startsWith('!')) {
        throw new ParseError('tags are not supported', {
            filename: ctx.filename,
            line: keyLine.no,
            construct: 'tag'
        });
    }
    if (text[0] === '{') {
        if (text.trim() !== '{}') {
            throw new ParseError('non-empty flow mappings are not supported', {
                filename: ctx.filename,
                line: keyLine.no,
                construct: 'flow-mapping'
            });
        }
        return {};
    }
    if (/^[|>][+-]?$/.test(text)) {
        return readBlockScalar(ctx, parentIndent, text, keyLine);
    }

    // Legacy read path: the old writer folded long *plain* scalars too, not
    // only double-quoted ones. A deeper-indented line that is not a mapping
    // entry and not a sequence item is a continuation of this scalar.
    //   notes: Generated as a Codex skill from Claude plugin skill
    //     soft-harness@soft-harness.
    if (text[0] !== '"' && text[0] !== "'" && text[0] !== '[') {
        const folded = [text];
        while (ctx.index < ctx.lines.length) {
            const next = ctx.lines[ctx.index];
            if (next.raw.trim() === '' || next.raw.trim().startsWith('#')) {
                break;
            }
            const nextIndent = indentOf(ctx, next);
            if (nextIndent <= parentIndent) {
                break;
            }
            const rest = next.raw.slice(nextIndent);
            if (splitKey(rest) || rest.startsWith('- ') || rest.trim() === '-') {
                break;
            }
            folded.push(stripComment(rest.trim()));
            ctx.index += 1;
        }
        if (folded.length > 1) {
            return folded.join(' ');
        }
    }

    return scalar(ctx, inlineText, keyLine);
}

// Legacy read path: `YAML.stringify` emitted `|-` for any string containing a
// newline. The new writer never produces this, but old files hold it.
function readBlockScalar(ctx, parentIndent, header, keyLine) {
    const style = header[0];
    const chomp = header.length > 1 ? header[1] : '';
    const collected = [];
    let blockIndent = null;

    while (ctx.index < ctx.lines.length) {
        const line = ctx.lines[ctx.index];
        if (line.raw.trim() === '') {
            collected.push('');
            ctx.index += 1;
            continue;
        }
        const lineIndent = indentOf(ctx, line);
        if (lineIndent <= parentIndent) {
            break;
        }
        if (blockIndent === null) {
            blockIndent = lineIndent;
        }
        collected.push(line.raw.slice(blockIndent));
        ctx.index += 1;
    }

    while (collected.length > 0 && collected[collected.length - 1] === '') {
        collected.pop();
    }

    let body;
    if (style === '|') {
        body = collected.join('\n');
    } else {
        body = foldLines(collected);
    }

    if (chomp === '-') {
        return body;
    }
    if (chomp === '+') {
        return `${body}\n`;
    }
    return collected.length === 0 ? '' : `${body}\n`;
}

function foldLines(lines) {
    let out = '';
    for (let i = 0; i < lines.length; i += 1) {
        if (i === 0) {
            out = lines[i];
            continue;
        }
        if (lines[i] === '') {
            out += '\n';
            continue;
        }
        out += out.endsWith('\n') ? lines[i] : ` ${lines[i]}`;
    }
    return out;
}

function scalar(ctx, rawText, line) {
    const text = rawText.trim();

    if (text[0] === '"') {
        return decodeDouble(ctx, collectQuoted(ctx, rawText, line, '"'), line);
    }
    if (text[0] === "'") {
        const joined = collectQuoted(ctx, rawText, line, "'");
        return joined.slice(1, -1).replace(/''/g, "'");
    }

    if (text.startsWith('[')) {
        return parseFlowSequence(ctx, stripComment(text), line);
    }

    const bare = stripComment(text);
    return typed(bare);
}

// A double-quoted scalar may be folded across lines by the old writer. Consume
// until the closing quote, folding line breaks the way YAML does.
function collectQuoted(ctx, firstLine, line, quote) {
    const start = firstLine.trim();
    let end = findQuoteEnd(start, quote);
    if (end !== -1) {
        assertOnlyComment(ctx, start.slice(end + 1), line);
        return start.slice(0, end + 1);
    }

    let joined = start;
    while (ctx.index < ctx.lines.length) {
        const next = ctx.lines[ctx.index];
        ctx.index += 1;
        const piece = next.raw.trim();
        joined += piece === '' ? '\n' : ` ${piece}`;
        end = findQuoteEnd(joined, quote);
        if (end !== -1) {
            assertOnlyComment(ctx, joined.slice(end + 1), line);
            return joined.slice(0, end + 1);
        }
    }
    throw new ParseError('unterminated quoted scalar', {
        filename: ctx.filename,
        line: line.no,
        construct: 'quoted-scalar'
    });
}

// Anything after the closing quote must be blank or an inline comment.
// `cron: '0 6 * * 1'  # Monday` is legal YAML and appears in real files.
function assertOnlyComment(ctx, trailing, line) {
    const rest = trailing.trim();
    if (rest === '' || rest.startsWith('#')) {
        return;
    }
    throw new ParseError(`unexpected content after a quoted scalar: ${JSON.stringify(rest)}`, {
        filename: ctx.filename,
        line: line.no,
        construct: 'quoted-scalar'
    });
}

// Index of the closing quote, or -1 when the scalar continues on later lines.
function findQuoteEnd(text, quote) {
    if (text.length < 2 || text[0] !== quote) {
        return -1;
    }
    let i = 1;
    while (i < text.length) {
        const ch = text[i];
        if (quote === '"' && ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === quote) {
            if (quote === "'" && text[i + 1] === "'") {
                i += 2;
                continue;
            }
            return i;
        }
        i += 1;
    }
    return -1;
}

function decodeDouble(ctx, text, line) {
    const body = text.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch !== '\\') {
            out += ch;
            continue;
        }
        const next = body[i + 1];
        i += 1;
        if (next === 'n') { out += '\n'; continue; }
        if (next === 't') { out += '\t'; continue; }
        if (next === 'r') { out += '\r'; continue; }
        if (next === '0') { out += '\0'; continue; }
        if (next === '"') { out += '"'; continue; }
        if (next === '\\') { out += '\\'; continue; }
        if (next === '/') { out += '/'; continue; }
        if (next === 'u') {
            const hex = body.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                throw new ParseError('invalid \\u escape in double-quoted scalar', {
                    filename: ctx.filename,
                    line: line.no,
                    construct: 'escape'
                });
            }
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            continue;
        }
        throw new ParseError(`unsupported escape \\${next} in double-quoted scalar`, {
            filename: ctx.filename,
            line: line.no,
            construct: 'escape'
        });
    }
    return out;
}

function parseFlowSequence(ctx, text, line) {
    const trimmed = text.trim();
    if (!trimmed.endsWith(']')) {
        throw new ParseError('unterminated flow sequence', {
            filename: ctx.filename,
            line: line.no,
            construct: 'flow-sequence'
        });
    }
    const body = trimmed.slice(1, -1).trim();
    if (body === '') {
        return [];
    }

    const items = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (quote) {
            current += ch;
            if (ch === '\\' && quote === '"') {
                current += body[i + 1];
                i += 1;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '[' || ch === '{') {
            throw new ParseError('nested flow collections are not supported', {
                filename: ctx.filename,
                line: line.no,
                construct: 'flow-nested'
            });
        }
        if (ch === ',') {
            items.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    items.push(current);

    return items.map((item) => {
        const value = item.trim();
        if (value[0] === '"' || value[0] === "'") {
            // A quoted item must actually close, or we would silently truncate
            // it: `["unterminated]` used to decode to "unterminate".
            const end = findQuoteEnd(value, value[0]);
            if (end !== value.length - 1) {
                throw new ParseError('unterminated quoted item in a flow sequence', {
                    filename: ctx.filename,
                    line: line.no,
                    construct: 'flow-sequence'
                });
            }
            return value[0] === '"'
                ? decodeDouble(ctx, value, line)
                : value.slice(1, -1).replace(/''/g, "'");
        }
        return typed(value);
    });
}

function stripComment(text) {
    let quote = null;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\' && quote === '"') {
                i += 1;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
            return text.slice(0, i).trim();
        }
    }
    return text.trim();
}

// Deliberately narrow implicit typing. Anything not listed here stays a string,
// including dates, `.inf`, `.nan`, and octal-looking values.
function typed(text) {
    if (text === '' || text === 'null' || text === '~' || text === 'Null' || text === 'NULL') {
        return null;
    }
    if (text === 'true' || text === 'True' || text === 'TRUE') {
        return true;
    }
    if (text === 'false' || text === 'False' || text === 'FALSE') {
        return false;
    }
    // Leading zeros are kept as integers to match what the `yaml` package
    // already did, so removing the dependency does not silently change values
    // that are on disk today. The safe-integer guard is the one deliberate
    // divergence: an oversized integer keeps its text rather than becoming an
    // imprecise float.
    if (/^-?\d+$/.test(text)) {
        const asNumber = Number(text);
        return Number.isSafeInteger(asNumber) ? asNumber : text;
    }
    if (/^-?(?:\d+\.\d*|\.?\d+)(?:[eE][+-]?\d+)?$/.test(text) && /[.eE]/.test(text)) {
        return Number(text);
    }
    return text;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function stringify(value) {
    if (value === undefined) {
        return '';
    }
    const lines = [];
    emit(value, 0, lines, true);
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function emit(value, indent, lines, isRoot) {
    const pad = ' '.repeat(indent);

    if (Array.isArray(value)) {
        if (value.length === 0) {
            if (isRoot) {
                lines.push('[]');
            }
            return;
        }
        for (const item of value) {
            if (isContainer(item) && !isEmptyContainer(item)) {
                const nested = [];
                emit(item, indent + 2, nested, false);
                lines.push(`${pad}-${nested[0].slice(indent + 1)}`);
                for (let i = 1; i < nested.length; i += 1) {
                    lines.push(nested[i]);
                }
                continue;
            }
            lines.push(`${pad}- ${formatScalar(item)}`);
        }
        return;
    }

    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
        if (isRoot) {
            lines.push('{}');
        }
        return;
    }

    for (const [key, item] of entries) {
        const name = formatKey(key);
        if (isContainer(item)) {
            if (isEmptyContainer(item)) {
                lines.push(`${pad}${name}: ${Array.isArray(item) ? '[]' : '{}'}`);
                continue;
            }
            lines.push(`${pad}${name}:`);
            emit(item, indent + 2, lines, false);
            continue;
        }
        lines.push(`${pad}${name}: ${formatScalar(item)}`);
    }
}

function isContainer(value) {
    return value !== null && typeof value === 'object';
}

function isEmptyContainer(value) {
    return Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
}

function formatKey(key) {
    const text = String(key);
    return needsQuote(text) ? quoteDouble(text) : text;
}

function formatScalar(value) {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`cannot serialize non-finite number: ${value}`);
        }
        return String(value);
    }
    const text = String(value);
    return needsQuote(text) ? quoteDouble(text) : text;
}

function needsQuote(text) {
    if (text === '') {
        return true;
    }
    if (/[\n\r\t]/.test(text)) {
        return true;
    }
    if (text !== text.trim()) {
        return true;
    }
    if (INDICATORS.includes(text[0])) {
        return true;
    }
    if (text.includes(': ') || text.endsWith(':') || / #/.test(text)) {
        return true;
    }
    // Would otherwise read back as something other than a string.
    return typed(text) !== text;
}

function quoteDouble(text) {
    const body = text
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `"${body}"`;
}

module.exports = {
    ParseError,
    parse,
    stringify
};
