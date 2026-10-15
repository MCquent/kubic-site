/* ============================================================
   Kubic — site vitrine
   ------------------------------------------------------------
   À chaque nouvelle version, une seule chose à modifier :
   version.json, à la racine du site. La page le lit et en tire
   le numéro, le poids, la date, le lien, l'empreinte SHA-256 et
   les nouveautés. C'est le même fichier que l'application
   consulte pour ses mises à jour : les deux ne peuvent plus
   se contredire.

   Les valeurs écrites dans index.html ne servent que si ce
   fichier est illisible (page ouverte par double-clic, sans
   serveur HTTP) ou si JavaScript est coupé.
   ============================================================ */

const i18n = window.KubicI18n || { t: (k, f) => f, lang: 'en' };
const t = (key, fallback) => i18n.t(key, fallback);
const onLang = fn => document.addEventListener('kubic:lang', fn);

/* ------------------------------------------------------------ version publiée */
(() => {
  if (!document.querySelector('[data-dl-version], [data-dl-file]')) return;

  let release = null;

  const set = (sel, val) => document.querySelectorAll(sel).forEach(el => { el.textContent = val; });

  const size = bytes => `${Math.round(bytes / 1048576)} ${t('unit.mb', 'MB')}`;

  // Date ISO « 2026-10-12 » → « 12 October 2026 » / « 12 octobre 2026 », en UTC pour ne pas glisser d'un jour.
  const date = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(t('locale', 'en-GB'), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d)));
  };

  // `notes` est la liste d'origine, en français, celle qu'affiche l'application ;
  // `notes_en` (et demain `notes_de`…) sa traduction pour le site.
  const notes = () => {
    const lang = i18n.lang;
    const list = lang === 'fr' ? release.notes : (release[`notes_${lang}`] || release.notes_en || release.notes);
    return Array.isArray(list) ? list.filter(n => typeof n === 'string' && n.trim()) : [];
  };

  const render = () => {
    if (!release) return;
    const file = release.url.split('/').pop();
    set('[data-dl-version]', release.version);
    set('[data-dl-filename]', file);
    if (release.taille) set('[data-dl-size]', size(release.taille));
    if (release.date) set('[data-dl-date]', date(release.date));
    set('[data-dl-sha]', release.sha256);
    document.querySelectorAll('[data-dl-file]').forEach(a => { a.href = release.url; });

    const box = document.getElementById('whats-new');
    const ul = document.querySelector('[data-dl-notes]');
    const items = notes();
    if (box && ul && items.length) {
      ul.replaceChildren(...items.map(n => Object.assign(document.createElement('li'), { textContent: n })));
      box.hidden = false;
      document.querySelectorAll('[data-whats-new-link]').forEach(a => { a.href = '#whats-new'; });
    }
  };

  fetch('version.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(m => {
      // Mêmes contrôles que l'application : un fichier mal formé ne remplace rien.
      if (!/^\d+\.\d+\.\d+$/.test(m.version) || !/^[0-9a-f]{64}$/i.test(m.sha256) || !/\.exe$/i.test(m.url || '')) {
        throw new Error('version.json incomplet');
      }
      release = {
        ...m,
        sha256: m.sha256.toLowerCase(),
        taille: Number.isInteger(m.taille) && m.taille > 0 ? m.taille : 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? m.date : '',
      };
      render();
    })
    .catch(err => console.info('Kubic : version.json non lu, valeurs de la page conservées.', err.message));

  onLang(render);
})();

/* ------------------------------------------------------------ année */
(() => {
  const paint = () => document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
  paint();
  onLang(paint);
})();

/* ------------------------------------------------------------ langue */
(() => {
  const select = document.getElementById('lang-select');
  if (!select || !window.KubicI18n) return;
  select.value = i18n.lang;
  select.addEventListener('change', () => i18n.apply(select.value, { save: true }));
  onLang(e => { select.value = e.detail; });
})();

/* ------------------------------------------------------------ thème */
(() => {
  // Le thème de départ est posé dans le <head>, avant le premier affichage.
  const root = document.documentElement;
  const meta = document.querySelector('meta[name="theme-color"]');
  const paint = () => { if (meta) meta.content = root.dataset.theme === 'light' ? '#f7f7f9' : '#08080a'; };
  paint();

  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('kubic-theme', root.dataset.theme); } catch { /* stockage bloqué : le choix vaut pour la visite */ }
    paint();
  });
})();

/* ------------------------------------------------------------ navigation */
(() => {
  const nav = document.getElementById('nav');
  const links = document.getElementById('nav-links');
  const burger = document.getElementById('nav-burger');
  if (!nav) return;

  const onScroll = () => nav.classList.toggle('is-stuck', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (!links || !burger) return;
  const close = () => { links.classList.remove('is-open'); burger.setAttribute('aria-expanded', 'false'); };
  burger.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && links.classList.contains('is-open')) { close(); burger.focus(); }
  });
})();

/* ------------------------------------------------------------ copier l'empreinte */
(() => {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    const source = document.querySelector(btn.dataset.copy);
    const status = btn.parentElement.querySelector('.copied');
    if (!source) return;
    let timer;
    const say = msg => {
      if (!status) return;
      status.textContent = msg;
      clearTimeout(timer);
      timer = setTimeout(() => { status.textContent = ''; }, 2500);
    };
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        say(t('dl.copied', 'Copied'));
      } catch {
        // Presse-papiers refusé (page en file://, navigateur ancien) : on sélectionne, Ctrl+C fera le reste.
        const range = document.createRange();
        range.selectNodeContents(source);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        say(t('dl.selected', 'Selected — press Ctrl+C'));
      }
    });
  });
})();

/* ------------------------------------------------------------ apparitions au défilement */
(() => {
  const items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;
  if (!window.IntersectionObserver || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach(el => el.classList.add('in'));
    return;
  }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      // Léger décalage entre voisins d'un même conteneur : l'ensemble se pose au lieu d'apparaître d'un bloc.
      const sibs = [...entry.target.parentElement.querySelectorAll(':scope > [data-reveal]')];
      entry.target.style.setProperty('--d', `${Math.min(sibs.indexOf(entry.target), 6) * 60}ms`);
      entry.target.classList.add('in');
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });

  items.forEach(el => io.observe(el));

  // Filet de sécurité : onglet ouvert en arrière-plan, observateur jamais déclenché…
  // au bout de trois secondes, tout s'affiche quoi qu'il arrive.
  setTimeout(() => items.forEach(el => el.classList.add('in')), 3000);
})();

/* ------------------------------------------------------------ inventaire de démonstration */
(() => {
  const armor = document.getElementById('mc-armor');
  const grid = document.getElementById('mc-grid');
  const hotbar = document.getElementById('mc-hotbar');
  if (!armor || !grid || !hotbar) return;

  // Vraies textures 16×16 du jeu, extraites du client 1.12.2 par l'application elle-même
  // (%APPDATA%/mc-server-manager/textures/) et affichées en rendu pixelisé.
  const TEX = 'assets/img/items/';

  // Chaque case : [texture, quantité, usure restante en %]. null = case vide.
  const ARMOR = [
    ['diamond_helmet', null, 62], ['diamond_chestplate', null, 88],
    ['iron_leggings', null, 35], ['diamond_boots', null, 71],
    'gap', ['bow_standby', null, 94],
  ];
  const BAG = [
    ['cobblestone', 64], null, ['planks_oak', 32], null, null, ['iron_ingot', 12], null, null, ['ender_pearl', 3],
    null, ['log_oak', 64], null, null, ['bread', 8], null, null, ['obsidian', 17], null,
    ['gold_ingot', 5], null, null, ['torch_on', 27], null, null, ['diamond', 9], null, ['glowstone', 22],
  ];
  const BAR = [
    ['diamond_sword', null, 78], ['diamond_pickaxe', null, 41], ['apple', 6], ['beef_cooked', 3], null,
    ['cobblestone', 64], null, ['torch_on', 16], ['diamond_block', 2],
  ];

  const cell = def => {
    const s = document.createElement('span');
    s.className = 'slot';
    if (def === 'gap') { s.className = 'slot slot-gap'; return s; }
    if (!def) return s;

    const [tex, qty, dur] = def;
    const i = document.createElement('span');
    i.className = 'it';
    i.style.backgroundImage = `url("${TEX}${tex}.png")`;
    s.append(i);

    if (qty) { const q = document.createElement('span'); q.className = 'qty'; q.textContent = qty; s.append(q); }
    if (dur) {
      const d = document.createElement('span'); d.className = 'dur';
      const f = document.createElement('i');
      f.style.width = `${dur}%`;
      // Vert → rouge, comme la barre d'usure du jeu.
      f.style.background = `hsl(${Math.round(dur * 1.2)} 70% 45%)`;
      d.append(f); s.append(d);
    }
    return s;
  };

  ARMOR.forEach(v => armor.append(cell(v)));
  BAG.forEach(v => grid.append(cell(v)));
  BAR.forEach(v => hotbar.append(cell(v)));
})();
