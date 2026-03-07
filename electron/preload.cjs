const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  loginChatGPT: () => ipcRenderer.invoke('login-chatgpt'),
  refreshChatGPTCookie: () => ipcRenderer.invoke('refresh-chatgpt-cookie'),
  getChatGPTProxyPort: () => ipcRenderer.invoke('get-chatgpt-proxy-port'),
  chatGPTDomChat: (params) => ipcRenderer.invoke('chatgpt-dom-chat', params),
  refreshChatWindow: () => ipcRenderer.invoke('refresh-chat-window'),
  calibrateSelectors: () => ipcRenderer.invoke('calibrate-selectors'),
  getSelectorStatus: () => ipcRenderer.invoke('get-selector-status'),
  resetSelectors: () => ipcRenderer.invoke('reset-selectors'),
});
