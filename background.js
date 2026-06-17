// Abre o painel principal em uma nova aba ao clicar no ícone da extensão
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
});

// Busca o HTML/texto de uma URL externa pelo service worker. Como a extensão tem
// host_permissions para os domínios da Câmara/Senado, o fetch aqui ignora CORS —
// é o jeito de "puxar direto", sem depender de proxies de terceiros.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fetchHtml' && msg.url) {
    fetch(msg.url, { credentials: 'omit', redirect: 'follow' })
      .then(r => r.text().then(text => sendResponse({ ok: r.ok, status: r.status, text })))
      .catch(err => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true; // mantém o canal aberto para a resposta assíncrona
  }
});
