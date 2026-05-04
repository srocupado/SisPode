// Abre o painel principal em uma nova aba ao clicar no ícone da extensão
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
});
