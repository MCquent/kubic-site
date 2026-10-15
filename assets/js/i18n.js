/* ============================================================
   Kubic — traductions du site
   ------------------------------------------------------------
   L'anglais est écrit directement dans les pages : c'est la
   langue par défaut, celle des moteurs de recherche et des
   visiteurs sans JavaScript.

   Chaque élément traduisible porte data-i18n="clé" (son contenu)
   ou data-i18n-attr="attribut:clé" (un attribut). Les autres
   langues sont dans assets/js/lang/<code>.js, un fichier par
   langue, chargé seulement quand on en a besoin. Une clé absente
   d'un fichier reste en anglais.

   Ajouter une langue : son code dans LANGUES ci-dessous, un
   fichier lang/<code>.js, une <option> dans le sélecteur de
   index.html et legal.html, et un champ notes_<code> dans
   version.json pour les nouveautés.
   ============================================================ */

(() => {
  const LANGUES = ['en', 'fr', 'es', 'de', 'it', 'pt'];
  const KEY = 'kubic-lang';
  const root = document.documentElement;
  const dossier = new URL('lang/', document.currentScript.src);

  const dicts = { en: {} };
  const enCours = {};

  /** Charge lang/<code>.js une fois ; le fichier s'inscrit lui-même par register(). */
  const charger = lang => {
    if (dicts[lang]) return Promise.resolve(dicts[lang]);
    if (!enCours[lang]) {
      enCours[lang] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = new URL(`${lang}.js`, dossier).href;
        s.onload = () => (dicts[lang] ? resolve(dicts[lang]) : reject(new Error(`lang/${lang}.js ne s'est pas inscrit`)));
        s.onerror = () => { delete enCours[lang]; s.remove(); reject(new Error(`lang/${lang}.js introuvable`)); };
        document.head.append(s);
      });
    }
    return enCours[lang];
  };

  const pairs = el => el.dataset.i18nAttr.split(';').map(p => p.split(':').map(s => s.trim()));

  // Les originaux anglais sont relevés une fois : on revient à l'anglais sans recharger.
  const nodes = [...document.querySelectorAll('[data-i18n]')].map(el => ({ el, key: el.dataset.i18n, en: el.innerHTML }));
  const attrs = [...document.querySelectorAll('[data-i18n-attr]')]
    .flatMap(el => pairs(el).map(([name, key]) => ({ el, name, key, en: el.getAttribute(name) })));

  let current = 'en';
  let ticket = 0;

  /** Texte d'une clé dans la langue en cours ; `fallback` (l'anglais) sinon. */
  const t = (key, fallback) => {
    const dict = dicts[current];
    return dict && key in dict ? dict[key] : fallback;
  };

  async function apply(lang, { save = false } = {}) {
    const voulue = LANGUES.includes(lang) ? lang : 'en';
    // Deux choix rapprochés : c'est le dernier qui gagne, même si l'autre fichier arrive après.
    const mien = ++ticket;
    let dict;
    try {
      dict = await charger(voulue);
    } catch (err) {
      console.warn('Kubic :', err.message, '— la page reste en anglais.');
    }
    if (mien !== ticket) return;

    current = dict ? voulue : 'en';
    const d = dicts[current];
    nodes.forEach(n => { n.el.innerHTML = n.key in d ? d[n.key] : n.en; });
    attrs.forEach(a => { a.el.setAttribute(a.name, a.key in d ? d[a.key] : a.en); });
    root.lang = current;
    root.dataset.lang = current;
    if (save) { try { localStorage.setItem(KEY, current); } catch { /* stockage bloqué : choix valable pour la visite */ } }
    root.classList.remove('i18n-wait');
    document.dispatchEvent(new CustomEvent('kubic:lang', { detail: current }));
  }

  window.KubicI18n = {
    apply,
    t,
    supported: LANGUES,
    get lang() { return current; },
    /** Appelé par chaque fichier lang/<code>.js. */
    register(lang, dict) { dicts[lang] = dict; },
    /** Pour la maintenance : les clés de la page sans traduction dans `lang` (une promesse). */
    async missing(lang) {
      const dict = await charger(lang);
      return [...new Set([...nodes, ...attrs].map(n => n.key))].filter(k => !(k in dict));
    },
  };

  apply(root.dataset.lang || 'en');
})();
