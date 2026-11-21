// SisPode — Sistemas Legislativos · Autor: Vinicius Lara (VLQ) · © 2025-2026
// Abre o painel principal em uma nova aba ao clicar no ícone da extensão
const SW_REV = 'f4ae9448a321e1e97364ff634b802bb7953d8e2f1cc9d3bf4d0ae7d51f8b6494';
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
});
