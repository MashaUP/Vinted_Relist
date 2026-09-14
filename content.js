/* Punto di ingresso: trova gli articoli nella pagina e ci attacca i bottoni. */
(async () => {
  const VR = (window.VR = window.VR || {});

  await VR.loadSettings();

  const CARD_SELECTORS = [
    '[class*="new-item-box__container"]',
    ".feed-grid__item",
    '[data-testid$="--wrapper"]',
  ];

  // ---------------------------------------------------------------- contesto

  function currentUserId() {
    const cookie = VR.cookie("v_uid");
    if (cookie && /^\d+$/.test(cookie)) return cookie;

    const link = document.querySelector(
      'header a[href^="/member/"], nav a[href^="/member/"], [data-testid*="user-menu"] a[href^="/member/"]'
    );
    const fromLink = link?.getAttribute("href")?.match(/\/member\/(\d+)/);
    if (fromLink) return fromLink[1];

    const nextData = document.getElementById("__NEXT_DATA__")?.textContent;
    const fromData = nextData?.match(/"(?:current_user_id|user_id)"\s*:\s*"?(\d+)"?/);
    return fromData ? fromData[1] : null;
  }

  function wardrobeOwnerId() {
    return location.pathname.match(/\/member\/(\d+)/)?.[1] || null;
  }

  function isOwnWardrobe() {
    const owner = wardrobeOwnerId();
    if (!owner) return false;
    if (VR.settings.showOnOtherProfiles) return true;
    const me = currentUserId();
    return !me || me === owner; // se non riesco a capirlo, mostro comunque
  }

  function itemIdFromHref(href) {
    return href?.match(/\/items\/(\d+)/)?.[1] || null;
  }

  // ---------------------------------------------------------------- injection

  function cardFor(anchor) {
    for (const selector of CARD_SELECTORS) {
      const found = anchor.closest(selector);
      if (found) return found;
    }
    let node = anchor;
    let best = anchor;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      node = node.parentElement;
      if (node.querySelectorAll('a[href*="/items/"]').length === 1) best = node;
      else break;
    }
    return best;
  }

  function attach(host, itemId, extraClass) {
    const bar = VR.buildActionBar(itemId);
    if (extraClass) bar.classList.add(extraClass);

    // Le card di Vinted sono dentro un <a>: blocco la navigazione sui click ai bottoni.
    bar.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();
        if (event.target.closest("button")) event.preventDefault();
      },
      true
    );

    host.insertAdjacentElement("afterend", bar);
    return bar;
  }

  function injectWardrobe() {
    if (!isOwnWardrobe()) return;

    for (const anchor of document.querySelectorAll('a[href*="/items/"]')) {
      const itemId = itemIdFromHref(anchor.getAttribute("href"));
      if (!itemId) continue;

      const card = cardFor(anchor);
      if (card.dataset.vrItem === itemId) continue;
      if (card.nextElementSibling?.classList?.contains("vr-bar")) continue;

      card.dataset.vrItem = itemId;
      const host = card.closest("a") || card;
      attach(host, itemId);
    }
  }

  function injectItemPage() {
    const itemId = itemIdFromHref(location.pathname);
    if (!itemId) return;
    if (document.querySelector(".vr-bar--floating")) return;

    // L'articolo e' mio solo se la pagina espone il link di modifica.
    const isMine = !!document.querySelector(`a[href*="/items/${itemId}/edit"]`);
    if (!isMine && !VR.settings.showOnOtherProfiles) return;

    const anchor = VR.h("div", { class: "vr-anchor" });
    document.body.append(anchor);
    attach(anchor, itemId, "vr-bar--floating");
  }

  function refresh() {
    try {
      injectWardrobe();
      injectItemPage();
    } catch (error) {
      VR.warn(error);
    }
  }

  // ---------------------------------------------------------------- osservatori

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.querySelectorAll(".vr-bar--floating, .vr-anchor").forEach((node) => node.remove());
      document.querySelectorAll("[data-vr-item]").forEach((node) => delete node.dataset.vrItem);
      schedule();
    }
  }, 600);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const patch = {};
    for (const [key, value] of Object.entries(changes)) patch[key] = value.newValue;
    Object.assign(VR.settings, patch);
    if (changes.seenOnboarding?.newValue === false) VR.showOnboarding({ force: true });
  });

  VR.showOnboarding();
  refresh();
  VR.log("attivo su", location.hostname);
})();
