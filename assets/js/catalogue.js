/* ============================================================
   Kubic — pages Extensions et Thèmes
   ------------------------------------------------------------
   Les catalogues sont des fichiers JSON publiés à côté des pages,
   et c'est d'eux que la page tire ses cartes, dans la langue du
   visiteur :

     extensions/index.json  le catalogue que Kubic lit lui-même
                            (onglet Extensions) — produit par
                            tools/construire-extensions.js de
                            l'application, avec les .kubicext et
                            les icônes ;
     themes/index.json      les thèmes à télécharger — produit par
                            tools/themes-site.js, avec les .zip.

   Publier une nouvelle extension ou un nouveau thème ne demande
   donc pas de toucher au HTML. Sans JavaScript, ou en ouvrant la
   page par double-clic (le navigateur refuse alors de lire un
   fichier local), la page le dit et renvoie aux dossiers.
   ============================================================ */

(() => {
  const i18n = window.KubicI18n || { t: (k, f) => f, lang: 'en' };
  const t = (key, fallback) => i18n.t(key, fallback);
  const langue = () => i18n.lang || 'en';
  const texte = v => (!v ? '' : typeof v === 'string' ? v : (v[langue()] || v.en || v.fr || Object.values(v)[0] || ''));

  /** Un élément, ses attributs (ou `text`), ses enfants. */
  const el = (tag, attrs = {}, ...enfants) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    e.append(...enfants.filter(Boolean));
    return e;
  };
  const icone = id => {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(ns, 'use');
    u.setAttribute('href', `#${id}`);
    s.append(u);
    return s;
  };
  const poids = o => (o < 1048576
    ? `${Math.max(1, Math.round(o / 1024))} ${t('unit.kb', 'KB')}`
    : `${(o / 1048576).toFixed(1)} ${t('unit.mb', 'MB')}`);

  const charger = url => fetch(url, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

  const erreur = (grille, dossier) => {
    grille.setAttribute('aria-busy', 'false');
    grille.replaceChildren(el('p', { class: 'cat-erreur' },
      el('span', { text: t('cat.error', 'The catalogue could not be loaded. If you opened this page from a file, serve the folder over HTTP — or browse the files directly:') }),
      ' ', el('a', { href: `${dossier}/`, text: `${dossier}/` })));
  };

  /* Ce qu'une extension peut demander — les mêmes droits que ceux que Kubic affiche avant de l'installer. */
  const DROITS = {
    enregistrer: ['perm.save', 'Saves files where you choose'],
    skin: ['perm.skin', 'Reads your skin'],
    appliquerSkin: ['perm.applyskin', 'Can change your skin — Kubic asks you every time'],
    textures: ['perm.textures', 'Reads the textures of the game installed on your PC'],
    mondes: ['perm.worlds', 'Reads your worlds (seed, End chunks) without changing anything'],
  };

  /* ------------------------------------------------------------ extensions */
  const grilleExt = document.querySelector('[data-catalogue="extensions"]');
  if (grilleExt) {
    let cat = null;
    const carte = e => {
      const droits = (e.permissions || []).map(p => el('li', { text: t(...(DROITS[p] || [`perm.${p}`, p])) }));
      return el('article', { class: 'cat-card', 'data-id': e.id },
        el('div', { class: 'cat-head' },
          e.icone ? el('img', { class: 'cat-ic', src: `extensions/${e.icone}`, width: 48, height: 48, alt: '', loading: 'lazy' }) : null,
          el('div', { class: 'cat-titre' },
            el('h3', { text: texte(e.nom) }),
            el('span', { class: 'cat-meta', text: `v${e.version}${e.auteur ? ` · ${e.auteur}` : ''}` }))),
        el('p', { class: 'cat-desc', text: texte(e.description) }),
        droits.length
          ? el('ul', { class: 'cat-perms', 'aria-label': t('cat.perms', 'What it can do') }, ...droits)
          : el('p', { class: 'cat-perms-aucun', text: t('perm.none', 'Asks for no particular access.') }),
        el('div', { class: 'cat-foot' },
          el('span', { class: 'cat-size', text: poids(e.taille) }),
          el('a', { class: 'btn btn-sm', href: `extensions/${e.fichier}`, download: e.fichier },
            icone('i-download'), el('span', { text: t('cat.download.ext', 'Download .kubicext') }))));
    };
    const peindre = () => {
      if (!cat) return;
      grilleExt.replaceChildren(...(cat.extensions || []).map(carte));
      grilleExt.setAttribute('aria-busy', 'false');
      document.querySelectorAll('[data-ext-count]').forEach(n => { n.textContent = String((cat.extensions || []).length); });
    };
    charger('extensions/index.json').then(d => { cat = d; peindre(); }).catch(() => erreur(grilleExt, 'extensions'));
    document.addEventListener('kubic:lang', peindre);
  }

  /* ------------------------------------------------------------ thèmes */
  /* L'aperçu : une fenêtre de Kubic en miniature, aux couleurs du thème (variables --t-*). */
  const apercu = (c, image = '') => el('div', {
    class: `tmock${c.deco ? ' deco' : ''}${image ? ' image' : ''}`, 'aria-hidden': 'true',
    style: [
      ...Object.entries({ bg: c.bg, panel: c.panel, panel2: c['panel-2'], line: c['line-2'] || c.line, txt: c.txt, txt2: c['txt-3'] || c['txt-2'], accent: c.accent, on: c['on-accent'] })
        .filter(([, v]) => /^#[0-9a-f]{3,8}$/i.test(String(v)))
        .map(([k, v]) => `--t-${k}:${v}`),
      /* Le liseré de certains habillages (Encre, Indigo) : un dégradé de deux couleurs, rien d'autre. */
      ...(/^linear-gradient\(90deg,\s*#[0-9a-f]{6},\s*#[0-9a-f]{6}\)$/i.test(String(c.deco || '')) ? [`--t-deco:${c.deco}`] : []),
      /*
       * L'image de fond d'un thème qui en a une (copiée par tools/themes-site.js
       * dans themes/apercus/). Posée sur l'élément lui-même : dans une variable,
       * l'adresse relative se résoudrait depuis style.css (assets/css/…).
       */
      ...(/^apercus\/[a-z0-9-]+\.(jpe?g|png|webp)$/i.test(image) ? [`background-image:url("themes/${image}")`] : []),
    ].join(';'),
  },
  el('div', { class: 'tm-side' }, el('i', { class: 'tm-logo' }), el('i', { class: 'tm-item on' }), el('i', { class: 'tm-item' }), el('i', { class: 'tm-item' }), el('i', { class: 'tm-btn' })),
  el('div', { class: 'tm-main' }, el('i', { class: 'tm-title' }), el('div', { class: 'tm-cards' }, el('i'), el('i'), el('i')), el('i', { class: 'tm-row' }), el('i', { class: 'tm-row court' })));

  const grilleThemes = document.querySelector('[data-catalogue="themes"]');
  if (grilleThemes) {
    let cat = null;
    const carte = th => el('article', { class: 'cat-card theme-card', 'data-id': th.id },
      apercu(th.apercu || {}, th.image || ''),
      el('div', { class: 'cat-titre' }, el('h3', { text: texte(th.nom) }), el('span', { class: 'cat-meta', text: `v${th.version}${th.auteur ? ` · ${th.auteur}` : ''}` })),
      el('p', { class: 'cat-desc', text: texte(th.description) }),
      el('div', { class: 'cat-foot' },
        el('span', { class: 'cat-size', text: poids(th.taille) }),
        el('a', { class: 'btn btn-sm', href: `themes/${th.fichier}`, download: th.fichier },
          icone('i-download'), el('span', { text: t('cat.download.theme', 'Download .zip') }))));
    const peindre = () => {
      if (!cat) return;
      grilleThemes.replaceChildren(...(cat.themes || []).map(carte));
      grilleThemes.setAttribute('aria-busy', 'false');
    };
    charger('themes/index.json').then(d => { cat = d; peindre(); }).catch(() => erreur(grilleThemes, 'themes'));
    document.addEventListener('kubic:lang', peindre);
  }

  /* Les habillages livrés : leurs aperçus sont écrits dans la page (data-palette). */
  document.querySelectorAll('[data-palette]').forEach(n => {
    try { n.prepend(apercu(JSON.parse(n.dataset.palette))); } catch { /* palette illisible : la carte reste sans aperçu */ }
  });
})();
