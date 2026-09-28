const { contextBridge, ipcRenderer } = require('electron');

const aiProxyPrefix = '--outlaw-code-ai-proxy=';
const aiProxyTokenPrefix = '--outlaw-code-ai-proxy-token=';
const aiProxyArg = process.argv.find((arg) => arg.startsWith(aiProxyPrefix));
const aiProxyTokenArg = process.argv.find((arg) => arg.startsWith(aiProxyTokenPrefix));
const aiProxyBaseURL = aiProxyArg?.slice(aiProxyPrefix.length);
const aiProxyToken = aiProxyTokenArg?.slice(aiProxyTokenPrefix.length);

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok === false) {
    const err = new Error(res.error.message);
    err.code = res.error.code;
    throw err;
  }
  return res ? res.value : undefined;
}

const terminalDataListeners = new Map();
const terminalExitListeners = new Map();
const terminalDataBuffers = new Map();
const terminalExitBuffers = new Map();
const MAX_BUFFERED_TERMINAL_CHARS = 1024 * 1024;

ipcRenderer.on('terminal:data', (_event, payload) => {
  const listener = terminalDataListeners.get(payload.sessionId);
  if (listener) {
    listener(payload.data);
    return;
  }
  const previous = terminalDataBuffers.get(payload.sessionId) || '';
  terminalDataBuffers.set(
    payload.sessionId,
    (previous + payload.data).slice(-MAX_BUFFERED_TERMINAL_CHARS),
  );
});

ipcRenderer.on('terminal:exit', (_event, payload) => {
  const listener = terminalExitListeners.get(payload.sessionId);
  if (listener) listener(payload);
  else terminalExitBuffers.set(payload.sessionId, payload);
});

contextBridge.exposeInMainWorld('outlawCode', {
  platform: process.platform,
  aiProxyBaseURL,
  aiProxyToken,
  fs: {
    openFolder: (preselected) => call('fs:openFolder', preselected),
    readDir: (p) => call('fs:readDir', p),
    readFile: (p) => call('fs:readFile', p),
    writeFile: (p, content) => call('fs:writeFile', p, content),
    createEntry: (p, kind) => call('fs:createEntry', p, kind),
    rename: (from, to) => call('fs:rename', from, to),
    delete: (p) => call('fs:delete', p),
    search: (query, maxResults) => call('fs:search', query, maxResults),
    watch: () => call('fs:watch'),
    unwatch: () => call('fs:unwatch'),
  },
  git: {
    available: () => call('git:available'),
    status: () => call('git:status'),
    stage: (paths) => call('git:stage', paths),
    unstage: (paths) => call('git:unstage', paths),
    commit: (message) => call('git:commit', message),
    discard: (paths) => call('git:discard', paths),
    diff: (p) => call('git:diff', p),
  },
  terminal: {
    create: (cols, rows) => call('terminal:create', cols, rows),
    input: (sessionId, data) => call('terminal:input', sessionId, data),
    resize: (sessionId, cols, rows) => call('terminal:resize', sessionId, cols, rows),
    dispose: async (sessionId) => {
      try {
        await call('terminal:dispose', sessionId);
      } finally {
        terminalDataListeners.delete(sessionId);
        terminalExitListeners.delete(sessionId);
        terminalDataBuffers.delete(sessionId);
        terminalExitBuffers.delete(sessionId);
      }
    },
    onData: (sessionId, callback) => {
      terminalDataListeners.set(sessionId, callback);
      const buffered = terminalDataBuffers.get(sessionId);
      if (buffered) {
        terminalDataBuffers.delete(sessionId);
        callback(buffered);
      }
      return () => terminalDataListeners.delete(sessionId);
    },
    onExit: (sessionId, callback) => {
      terminalExitListeners.set(sessionId, callback);
      const buffered = terminalExitBuffers.get(sessionId);
      if (buffered) {
        terminalExitBuffers.delete(sessionId);
        callback(buffered);
      }
      return () => terminalExitListeners.delete(sessionId);
    },
  },
  onFsEvents: (callback) => {
    const listener = (_event, events) => callback(events);
    ipcRenderer.on('fs:watch:event', listener);
    return () => ipcRenderer.off('fs:watch:event', listener);
  },
});
