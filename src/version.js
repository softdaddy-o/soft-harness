function compareVersions(left, right) {
    const leftVersion = parseVersion(left);
    const rightVersion = parseVersion(right);
    if (!leftVersion || !rightVersion) {
        return null;
    }

    const count = Math.max(leftVersion.parts.length, rightVersion.parts.length);
    for (let index = 0; index < count; index += 1) {
        const leftPart = leftVersion.parts[index] || 0;
        const rightPart = rightVersion.parts[index] || 0;
        if (leftPart < rightPart) {
            return -1;
        }
        if (leftPart > rightPart) {
            return 1;
        }
    }

    if (leftVersion.prerelease && !rightVersion.prerelease) {
        return -1;
    }
    if (!leftVersion.prerelease && rightVersion.prerelease) {
        return 1;
    }
    if (leftVersion.prerelease && rightVersion.prerelease) {
        return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
    }
    return 0;
}

function parseVersion(value) {
    const text = String(value || '').trim();
    const match = text.match(/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/u);
    if (!match) {
        return null;
    }

    return {
        parts: match[1].split('.').map((part) => Number.parseInt(part, 10)),
        prerelease: match[2] || null
    };
}

module.exports = {
    compareVersions
};
