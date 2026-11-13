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

/* ------------------------------------------------------------ système du visiteur
   « win », « mac » ou « linux » : l'onglet ouvert d'office dans Téléchargement
   et l'icône des boutons. Un téléphone ou un système inconnu compte pour
   Windows, le plus courant. Le navigateur ne dit pas si un Mac est à puce Apple
   ou Intel : les deux fichiers sont proposés côte à côte. */
const OS = (() => {
  const ua = navigator.userAgent || '';
  const p = `${(navigator.userAgentData && navigator.userAgentData.platform) || ''} ${navigator.platform || ''}`;
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'win';
  if (/mac/i.test(p) || /Macintosh|Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'win' : 'mac';
  if (/linux|x11/i.test(p) || /X11|Linux/.test(ua)) return /CrOS/.test(ua) ? 'win' : 'linux';
  return 'win';
})();
const OS_ICONE = { win: '#i-windows', mac: '#i-macos', linux: '#i-linux' };

(() => {
  document.querySelectorAll('svg[data-os-icon] use').forEach(u => {
    if (document.getElementById(OS_ICONE[OS].slice(1))) u.setAttribute('href', OS_ICONE[OS]);
  });
  // Le bandeau final télécharge l'installateur Windows d'un clic ; ailleurs, il mène aux bons fichiers.
  if (OS !== 'win') {
    document.querySelectorAll('a[data-dl-direct]').forEach(a => {
      a.removeAttribute('data-dl-file');
      a.removeAttribute('download');
      a.href = '#download';
    });
  }
})();

/* ------------------------------------------------------------ onglets de téléchargement */
(() => {
  const tabs = [...document.querySelectorAll('[data-os-tab]')];
  const panels = [...document.querySelectorAll('[data-os-panel]')];
  if (!tabs.length || !panels.length) return;

  const choisir = (os, { focus = false } = {}) => {
    tabs.forEach(b => {
      const on = b.dataset.osTab === os;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panels.forEach(p => { p.hidden = p.dataset.osPanel !== os; });
  };

  tabs[0].closest('[role="tablist"]').hidden = false;
  choisir(OS);

  tabs.forEach((b, i) => {
    b.addEventListener('click', () => choisir(b.dataset.osTab));
    b.addEventListener('keydown', e => {
      const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      choisir(tabs[(n + tabs.length) % tabs.length].dataset.osTab, { focus: true });
    });
  });

  // #download-mac, #download-linux : un lien peut ouvrir un onglet précis (la FAQ le fait).
  const depuisAncre = () => {
    const m = /^#download-(win|mac|linux)$/.exec(location.hash);
    if (!m) return;
    choisir(m[1]);
    const sec = document.getElementById('download');
    if (sec) sec.scrollIntoView();
  };
  window.addEventListener('hashchange', depuisAncre);
  depuisAncre();
})();

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

    // Les paquets macOS et Linux : une entrée par fichier, chacune avec son lien, son empreinte et sa taille.
    for (const [cle, p] of Object.entries(release.paquets)) {
      document.querySelectorAll(`[data-pkg="${cle}"]`).forEach(a => { a.href = p.url; });
      set(`[data-pkg-sha="${cle}"]`, p.sha256);
      set(`[data-pkg-filename="${cle}"]`, p.url.split('/').pop());
      if (p.taille) set(`[data-pkg-size="${cle}"]`, size(p.taille));
    }

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
      // Un paquet mal formé est ignoré seul : sa carte garde les valeurs de la page.
      const paquets = {};
      for (const [cle, p] of Object.entries(m.paquets && typeof m.paquets === 'object' ? m.paquets : {})) {
        if (!/^[a-z0-9-]+$/.test(cle) || !p || !/^https:\/\//.test(p.url || '') || !/^[0-9a-f]{64}$/i.test(p.sha256 || '')) continue;
        paquets[cle] = { url: p.url, sha256: p.sha256.toLowerCase(), taille: Number.isInteger(p.taille) && p.taille > 0 ? p.taille : 0 };
      }
      release = {
        ...m,
        sha256: m.sha256.toLowerCase(),
        taille: Number.isInteger(m.taille) && m.taille > 0 ? m.taille : 0,
        date: /^\d{4}-\d{2}-\d{2}$/.test(m.date || '') ? m.date : '',
        paquets,
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
  const paint = () => { if (meta) meta.content = root.dataset.theme === 'light' ? '#f8f7fd' : '#07060c'; };
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

/* ------------------------------------------------------------ rubrique en cours, dans la barre
   Sur l'accueil, les liens de la barre portent data-spy="<id d'une rubrique>". Celui
   de la dernière rubrique dont le haut est passé sous la barre est marqué (.is-active) :
   « Fonctionnalités » le reste donc pour toutes les sections jusqu'au téléchargement. */
(() => {
  const liens = [...document.querySelectorAll('.nav-links a[data-spy]')];
  const cibles = liens.map(a => document.getElementById(a.dataset.spy)).filter(Boolean);
  if (cibles.length !== liens.length || !cibles.length) return;

  let attente = false;
  const marquer = () => {
    attente = false;
    const seuil = (document.getElementById('nav')?.offsetHeight || 72) + 120;
    let i = 0;
    cibles.forEach((el, n) => { if (el.getBoundingClientRect().top <= seuil) i = n; });
    // Tout en bas, la dernière rubrique peut être trop courte pour atteindre le seuil.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) i = cibles.length - 1;
    liens.forEach((a, n) => a.classList.toggle('is-active', n === i));
  };
  const demander = () => { if (!attente) { attente = true; requestAnimationFrame(marquer); } };
  marquer();
  window.addEventListener('scroll', demander, { passive: true });
  window.addEventListener('resize', demander);
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
