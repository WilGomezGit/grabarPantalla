const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wagDesktop', {
  getSources: () => ipcRenderer.invoke('sources'),
  setSource: (id, audio) => ipcRenderer.invoke('setSource', id, audio),
  compact: on => ipcRenderer.send('compact', on),
  bubbleOpen: o => ipcRenderer.invoke('bubbleOpen', o),
  bubbleState: s => ipcRenderer.send('bubbleState', s),
  bubbleClose: () => ipcRenderer.send('bubbleClose'),
  onBubbleState: cb => ipcRenderer.on('bubble-state', (_e, s) => cb(s)),
  onGlobal: cb => ipcRenderer.on('global', (_e, a) => cb(a))
});
