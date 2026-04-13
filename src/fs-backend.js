const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');

function createNodeBackend() {
    return {
        cpSync: fs.cpSync.bind(fs),
        existsSync: fs.existsSync.bind(fs),
        lstatSync: fs.lstatSync.bind(fs),
        mkdirSync: fs.mkdirSync.bind(fs),
        readFileSync: fs.readFileSync.bind(fs),
        readdirSync: fs.readdirSync.bind(fs),
        readlinkSync: fs.readlinkSync.bind(fs),
        rmSync: fs.rmSync.bind(fs),
        statSync: fs.statSync.bind(fs),
        symlinkSync: fs.symlinkSync.bind(fs),
        writeFileSync: fs.writeFileSync.bind(fs)
    };
}

const NODE_BACKEND = createNodeBackend();
let activeBackend = NODE_BACKEND;
const backendStorage = new AsyncLocalStorage();

function getFsBackend() {
    return backendStorage.getStore() || activeBackend;
}

function setFsBackend(backend) {
    activeBackend = backend || NODE_BACKEND;
}

function resetFsBackend() {
    activeBackend = NODE_BACKEND;
}

function withFsBackend(backend, fn) {
    return backendStorage.run(backend || NODE_BACKEND, fn);
}

module.exports = {
    getFsBackend,
    resetFsBackend,
    setFsBackend,
    withFsBackend
};
