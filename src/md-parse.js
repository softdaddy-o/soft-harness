function normalizeHeadingText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeContent(content) {
    return String(content || '').replace(/\r\n/g, '\n');
}

function parseMarkdownSections(content) {
    const normalized = normalizeContent(content);
    if (normalized.length === 0) {
        return [{
            heading: '',
            level: 0,
            body: '',
            raw: ''
        }];
    }

    const lines = normalized.split('\n');
    const headings = [];
    let activeFence = null;

    for (let index = 0; index < lines.length; index += 1) {
        const fence = parseFence(lines[index]);
        if (fence) {
            if (!activeFence) {
                activeFence = fence;
                continue;
            }
            if (fence.marker === activeFence.marker && fence.length >= activeFence.length) {
                activeFence = null;
                continue;
            }
        }
        if (activeFence) {
            continue;
        }

        const match = /^(#{1,6})\s*(.*?)\s*$/.exec(lines[index]);
        if (!match) {
            continue;
        }
        headings.push({
            index,
            level: match[1].length,
            heading: normalizeHeadingText(match[2])
        });
    }

    if (headings.length === 0) {
        return [{
            heading: '',
            level: 0,
            body: normalized,
            raw: normalized
        }];
    }

    const sections = [];
    if (headings[0].index > 0) {
        const raw = lines.slice(0, headings[0].index).join('\n').trim();
        if (raw.length > 0) {
            sections.push({
                heading: '',
                level: 0,
                body: raw,
                raw
            });
        }
    }

    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        let endIndex = lines.length;
        for (let inner = index + 1; inner < headings.length; inner += 1) {
            if (headings[inner].level <= heading.level) {
                endIndex = headings[inner].index;
                break;
            }
        }

        const raw = lines.slice(heading.index, endIndex).join('\n').trim();
        const body = lines.slice(heading.index + 1, endIndex).join('\n').trim();
        sections.push({
            heading: heading.heading,
            level: heading.level,
            body,
            raw
        });
    }

    return sections;
}

function parseFence(line) {
    const match = /^\s*([`~]{3,})(.*)$/.exec(String(line || ''));
    if (!match) {
        return null;
    }
    return {
        marker: match[1][0],
        length: match[1].length
    };
}

module.exports = {
    normalizeContent,
    normalizeHeadingText,
    parseMarkdownSections
};
