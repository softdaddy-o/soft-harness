const path = require('node:path');
const { ensureDir, formatOffsetDate, readJson, writeJson } = require('./fs-util');

function getHarnessDir(rootDir) {
    return path.join(rootDir, '.harness');
}

function getStatePath(rootDir) {
    return path.join(getHarnessDir(rootDir), '.sync-state.json');
}

function getDefaultState() {
    return {
        version: 1,
        synced_at: null,
        assets: {
            instructions: [],
            settings: [],
            skills: [],
            agents: []
        },
        plugins: [],
        classifications: {}
    };
}

function loadState(rootDir) {
    const statePath = getStatePath(rootDir);
    const state = readJson(statePath, getDefaultState());
    return {
        ...getDefaultState(),
        ...state,
        assets: {
            ...getDefaultState().assets,
            ...(state.assets || {})
        },
        classifications: {
            ...((state && state.classifications) || {})
        }
    };
}

function saveState(rootDir, state, date) {
    const nextState = {
        ...getDefaultState(),
        ...state,
        synced_at: formatOffsetDate(date || new Date())
    };

    ensureDir(getHarnessDir(rootDir));
    writeJson(getStatePath(rootDir), nextState);
    return nextState;
}

module.exports = {
    getDefaultState,
    getHarnessDir,
    getStatePath,
    loadState,
    saveState
};
