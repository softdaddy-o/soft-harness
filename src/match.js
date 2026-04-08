function matchesAnyPattern(value, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) {
        return false;
    }

    const normalized = normalize(value);
    return patterns.some((pattern) => wildcardMatch(normalized, normalize(pattern)));
}

function wildcardMatch(value, pattern) {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return regex.test(value);
}

function normalize(value) {
    return String(value || '').replace(/\\/g, '/');
}

module.exports = {
    matchesAnyPattern,
    normalize
};
