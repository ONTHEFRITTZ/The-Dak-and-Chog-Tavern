// games/poker/table-bankroll.js
// Deprecated: shim loader for the global bankroll helper.
(function () {
  if (window.Bankroll && window.Bankroll.__isGlobalBankroll) {
    window.__PokerBankroll = window.Bankroll;
    return;
  }
  try {
    const current = document.currentScript;
    const query = current?.src?.includes('?') ? '?' + current.src.split('?')[1] : '';
    const script = document.createElement('script');
    script.defer = true;
    script.src = '/js/bankroll.js' + query;
    script.onload = function () {
      if (window.Bankroll && window.Bankroll.__isGlobalBankroll) {
        window.__PokerBankroll = window.Bankroll;
      }
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error('bankroll shim failed to load global helper', err);
  }
})();
