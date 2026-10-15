/* ============================================================
   Kubic — le visionneur 3D du site
   ------------------------------------------------------------
   La section « 3D schematic viewer » reproduit l'écran Schematics
   de l'application, et sa scène est vivante : le moteur est celui
   de l'application (moteur3d.js et maillage.js, copiés tels quels)
   et le plan a été exporté par l'application elle-même (géométrie
   tirée des modèles du jeu, planche des seules textures employées,
   dans assets/viewer/). Ce fichier fait le reste : chargement quand
   la section approche, rotation d'accueil, et les commandes de
   l'écran — Couches, Recadrer, Pivoter, Vol libre, Matériaux,
   Commandes — qui font ce qu'elles font dans l'application.

   Changer de plan : voir « Le visionneur 3D » dans le README.
   ============================================================ */

import { Moteur, DISPOSITIONS } from './moteur3d.js';

const PLAN = 'assets/viewer/720k-concrete-swapper';
/* Le premier regard : de trois quarts, un peu au-dessus, assez près pour lire la redstone. */
const LACET = 0.6;
const TANGAGE = 0.42;
const RAPPROCHE = 0.82;
/* La rotation d'accueil, en radians par seconde : lente, pour qu'on ait envie d'y toucher. */
const ROTATION = 0.16;

const fig = document.getElementById('viewer');
const scene = document.getElementById('viewer-stage');
const cv = document.getElementById('viewer-cv');
const i18n = window.KubicI18n;
const t = (k, f) => (i18n ? i18n.t(k, f) : f);
const $ = (id) => document.getElementById(id);

let moteur = null;
let plan = null;
let stats = null;
let dispo = 'qwerty';
let actif = false;          // le visiteur a la main : molette et clavier vont à la scène
let tourne = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let visible = false;

const nombre = (n) => n.toLocaleString(t('locale', 'en-GB'));

/*
 * On ne charge rien tant que la section est loin : le plan pèse un demi-
 * mégaoctet, et la page doit s'afficher sans lui. On démarre quand elle
 * approche de l'écran.
 */
if (fig && cv) {
  let parti = false;
  const partir = () => { if (!parti) { parti = true; guet.disconnect(); demarrer(); } };
  const guet = new IntersectionObserver((entrees) => {
    if (entrees.some((e) => e.isIntersecting)) partir();
  }, { rootMargin: '400px 0px' });
  guet.observe(fig);
  // Filet de sécurité, comme pour les apparitions : un observateur jamais déclenché
  // (onglet en arrière-plan…) ne doit pas laisser l'écran figé. Trois secondes après
  // le chargement, on part quoi qu'il arrive.
  const plusTard = () => setTimeout(partir, 3000);
  if (document.readyState === 'complete') plusTard(); else addEventListener('load', plusTard, { once: true });
}

/* ------------------------------------------------------------ chargement */

async function demarrer() {
  try {
    plan = await chargerPlan(PLAN);
  } catch (e) {
    console.warn('Kubic : plan 3D illisible, la page garde son image et sa liste.', e);
    return;
  }
  // Nom, auteur, dimensions, matériaux : tout vient du plan, en changer ne demande qu'un nouvel export.
  dispo = await dispositionProbable();
  $('vw-dispo').value = dispo;
  majTextes();
  document.addEventListener('kubic:lang', majTextes);
  $('mats-filtre').addEventListener('input', majMateriaux);

  if (!document.createElement('canvas').getContext('webgl2')) {
    message(t('vw.nogl', 'Your browser cannot display WebGL 2, so here is a still image of the 3D view.'));
    return;
  }
  try {
    moteur = new Moteur(cv);
    moteur.clavier = (e) => actif && !((e.ctrlKey || e.metaKey || e.altKey) && e.code === 'KeyF');
    moteur.couleurFond(fondDeScene());
    moteur.surVol = majVol;
    moteur.surVisee = majVisee;
    moteur.surTranche = (bas, haut) => majCouches(bas, haut);
    await appliquerDispo();

    stats = await moteur.charger(plan);
    moteur.cadrer(LACET, TANGAGE);
    moteur.camera.distance *= RAPPROCHE;

    const h = plan.modele.taille.y - 1;
    for (const id of ['vw-bas', 'vw-haut']) $(id).max = String(h);
    majCouches(0, h);
    majTextes();

    brancher();
    moteur.demander();
    fig.classList.add('is-live');
    requestAnimationFrame(boucle);
  } catch (e) {
    console.warn('Kubic : visionneur 3D indisponible, l’image reste.', e);
  }
}

async function chargerPlan(base) {
  const [json, bin] = await Promise.all([
    fetch(`${base}.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    fetch(`${base}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))),
  ]);
  // Les tableaux binaires reviennent tels que l'application les avait (voir binaire dans le JSON).
  const types = { Int16Array, Uint8Array, Uint16Array, Uint32Array };
  for (const [nom, d] of Object.entries(json.binaire)) json.modele[nom] = new types[d.type](bin, d.debut, d.n);
  json.atlas = new URL(json.atlas, new URL(`${base}.json`, document.baseURI)).href;
  return json;
}

/** La couleur de fond, prise au thème : la scène se fond dans son cadre. */
function fondDeScene() {
  const c = getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? [1, 2, 3].map((i) => parseInt(m[i], 16) / 255) : [0.063, 0.063, 0.078];
}

/**
 * Une promesse, ou sa valeur de repli au bout de `ms` millisecondes.
 *
 * La table du clavier (`navigator.keyboard.getLayoutMap`) peut ne jamais
 * répondre — page sans le focus, onglet en arrière-plan — et rien ne doit
 * attendre après elle.
 */
const bientot = (promesse, ms, repli) => Promise.race([
  Promise.resolve(promesse).catch(() => repli),
  new Promise((ok) => { setTimeout(() => ok(repli), ms); }),
]);

/**
 * Donne au moteur les touches de la disposition choisie. Si le navigateur ne
 * dit pas où sont les lettres, on les suppose là où elles sont gravées
 * (`KeyW` pour W) : c'est aussi ce que fait le moteur faute de table.
 */
async function appliquerDispo() {
  const codes = await bientot(moteur.disposition(dispo), 400, null);
  if (!codes) {
    moteur.codes = Object.fromEntries(Object.entries(DISPOSITIONS[dispo]).map(([role, l]) => [role, `Key${l}`]));
    moteur.vol.touches.clear();
  }
}

/** AZERTY ou QWERTY : on regarde ce que porte la touche sous l'auriculaire gauche. */
async function dispositionProbable() {
  const parLangue = /^fr\b/i.test(navigator.language || '') ? 'azerty' : 'qwerty';
  try {
    const carte = await bientot(navigator.keyboard.getLayoutMap(), 400, null);
    return carte ? (carte.get('KeyQ') === 'a' ? 'azerty' : 'qwerty') : parLangue;
  } catch {
    return parLangue;
  }
}

/* ------------------------------------------------------------ rotation d'accueil */

let avant = 0;
function boucle(ts) {
  if (!moteur) return;
  if (tourne && visible && !document.hidden && !moteur.vol.actif) {
    const dt = avant ? Math.min(0.05, (ts - avant) / 1000) : 0;
    moteur.camera.lacet -= dt * ROTATION;
    moteur.demander();
  }
  avant = ts;
  requestAnimationFrame(boucle);
}

/** Le visiteur prend la main : la rotation s'arrête pour de bon, l'indice s'efface. */
function prendreLaMain() {
  tourne = false;
  actif = true;
  fig.classList.add('a-touche');
}

/* ------------------------------------------------------------ commandes */

function brancher() {
  // Prendre la main : tout geste dans l'écran. La lâcher : un clic ailleurs.
  fig.addEventListener('pointerdown', prendreLaMain, { capture: true });
  document.addEventListener('pointerdown', (e) => {
    if (!fig.contains(e.target) && !document.fullscreenElement) actif = false;
  });
  cv.addEventListener('focus', () => { actif = true; });

  /*
   * La molette n'est à la scène qu'une fois la main prise. Avant, elle fait
   * défiler la page comme partout : un visiteur qui descend la page ne doit
   * pas se retrouver à zoomer parce que son curseur a croisé la toile.
   */
  scene.addEventListener('wheel', (e) => { if (!actif) e.stopPropagation(); }, { capture: true, passive: true });

  pincer();

  // Recadrer et Pivoter : les gestes des boutons de l'application.
  $('vw-reset').addEventListener('click', () => {
    if (moteur.vol.actif) moteur.voler(false);
    moteur.cadrer(LACET, TANGAGE);
    moteur.camera.distance *= RAPPROCHE;
  });
  $('vw-rot').addEventListener('click', () => {
    moteur.camera.lacet -= Math.PI / 2;     // un quart de tour, comme dans l'app
    moteur.demander();
  });

  /* Les couches par les deux bouts : chaque borne s'arrête sur l'autre, comme dans l'app. */
  const bas = $('vw-bas');
  const haut = $('vw-haut');
  const couper = (qui) => {
    let b = Number(bas.value);
    let h = Number(haut.value);
    if (b > h) { if (qui === bas) b = h; else h = b; }
    moteur.tranche(b, h);
    majCouches(b, h);
  };
  bas.addEventListener('input', () => couper(bas));
  haut.addEventListener('input', () => couper(haut));

  $('vw-fly').addEventListener('click', () => { actif = true; moteur.voler(!moteur.vol.actif); });

  $('vw-dispo').addEventListener('change', async (e) => {
    dispo = e.target.value;
    await appliquerDispo();
    majTouches();
    majAide();
  });

  const plein = $('vw-full');
  if (!document.fullscreenEnabled) plein.hidden = true;
  plein.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else fig.requestFullscreen().catch(() => { /* refusé : on reste dans la page */ });
  });
  document.addEventListener('fullscreenchange', () => {
    const oui = document.fullscreenElement === fig;
    plein.setAttribute('aria-pressed', String(oui));
    captif();
    if (oui) actif = true;
  });

  // La toile change de taille avec la fenêtre : une image de plus suffit, le moteur relit sa taille.
  new ResizeObserver(() => moteur.demander()).observe(cv);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(scene);

  // Le thème change la couleur du fond.
  new MutationObserver(() => { moteur.couleurFond(fondDeScene()); moteur.demander(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

/**
 * Pincer pour zoomer, au doigt.
 *
 * Le moteur ne connaît que la souris : un doigt tourne, et c'est très bien.
 * Avec deux, on écarte ou rapproche la caméra, et l'on retient le mouvement
 * avant le moteur — sinon le premier doigt ferait aussi tourner la scène.
 */
function pincer() {
  const doigts = new Map();
  const ecart = () => {
    const [a, b] = [...doigts.values()];
    return a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0;
  };
  scene.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') doigts.set(e.pointerId, [e.clientX, e.clientY]);
  }, { capture: true });
  scene.addEventListener('pointermove', (e) => {
    if (!doigts.has(e.pointerId)) return;
    const d0 = ecart();
    doigts.set(e.pointerId, [e.clientX, e.clientY]);
    if (doigts.size < 2) return;
    e.stopPropagation();
    const d1 = ecart();
    if (d0 > 0 && d1 > 0) {
      const t0 = plan.modele.taille;
      const loin = 3 * Math.hypot(t0.x, t0.y, t0.z);
      moteur.camera.distance = Math.min(loin, Math.max(3, moteur.camera.distance * (d0 / d1)));
      moteur.demander();
    }
  }, { capture: true });
  const lever = (e) => doigts.delete(e.pointerId);
  scene.addEventListener('pointerup', lever, { capture: true });
  scene.addEventListener('pointercancel', lever, { capture: true });
}

/** En plein écran ou en vol, la scène prend tous les gestes. */
function captif() {
  fig.classList.toggle('is-captive', !!document.fullscreenElement || (moteur && moteur.vol.actif));
}

/* ------------------------------------------------------------ affichage */

function majCouches(bas, haut) {
  $('vw-bas').value = String(bas);
  $('vw-haut').value = String(haut);
  $('vw-couches').textContent = `${bas} → ${haut}`;
}

function majVol(oui) {
  $('viewer-fly').hidden = !oui;
  $('vw-fly').setAttribute('aria-pressed', String(oui));
  $('vw-fly-t').textContent = oui ? t('sch.flyexit', 'Leave flight') : t('sch.fly', 'Free flight');
  if (oui) { tourne = false; actif = true; fig.classList.add('a-touche'); }
  if (!oui) majVisee(null);
  captif();
}

/** Le bloc au bout du réticule : son nom, sa position, ses propriétés notables. */
function majVisee(v) {
  const boite = $('viewer-aim');
  const p = v && plan.palette[v.etat - 1];
  if (!p) { boite.hidden = true; boite.textContent = ''; return; }
  const m = plan.materiaux.find((x) => x.nom === p.name);
  const nom = (m && m.label) || String(p.name).replace(/^minecraft:/, '');
  const props = Object.entries(p.properties || {})
    .filter(([, x]) => x !== 'false')
    .map(([k, x]) => (x === 'true' ? k : `${k}=${x}`))
    .slice(0, 3)
    .join(' ');
  boite.replaceChildren(
    Object.assign(document.createElement('b'), { textContent: nom }),
    Object.assign(document.createElement('small'), { textContent: `${v.x} ${v.y} ${v.z}${props ? ` · ${props}` : ''}` }),
  );
  boite.hidden = false;
}

const kbd = (...x) => x.map((s) => `<kbd>${s}</kbd>`).join('');

/** Les touches du vol, en bandeau sur la scène, avec les lettres du clavier du visiteur. */
function majTouches() {
  const l = DISPOSITIONS[dispo] || DISPOSITIONS.qwerty;
  $('viewer-keys').innerHTML = [
    `${kbd(l.avant, l.gauche, l.arriere, l.droite)} ${t('vw.k.move', 'move')}`,
    `${kbd(t('vw.k.space', 'Space'))}/${kbd('Ctrl')} ${t('vw.k.updown', 'up, down')}`,
    `${kbd(t('vw.k.wheel', 'Wheel'))} ${t('vw.k.speed', 'speed')}`,
    `${kbd(l.loupe)} ${t('vw.k.zoom', 'zoom')}`,
    `${kbd(l.masquer)} ${t('vw.k.hide', 'hide block')}`,
    `${kbd(l.montrer)} ${t('vw.k.show', 'show all')}`,
    `${kbd(t('vw.k.esc', 'Esc'))} ${t('vw.k.exit', 'exit')}`,
  ].join(' · ');
}

/** La carte « Commandes » de l'application, avec la même liste. */
function majAide() {
  const l = DISPOSITIONS[dispo] || DISPOSITIONS.qwerty;
  const ou = (a, b, s = '/') => `${a}<span class="muted"> ${s} </span>${b}`;
  const lignes = (titre, l2) => `<dt>${titre}</dt>${l2.map(([k, q]) => `<dd class="k">${k}</dd><dd>${q}</dd>`).join('')}`;
  $('viewer-aide').innerHTML = lignes(t('sch.h.fly', 'In free flight'), [
    [kbd('F'), t('sch.k.toggle', 'Enter or leave free flight')],
    [kbd(l.avant, l.gauche, l.arriere, l.droite), t('sch.k.move', 'Move')],
    [ou(kbd(t('sch.key.space', 'Space')), kbd('Ctrl')), t('sch.k.updown', 'Up, down')],
    [kbd(t('sch.key.wheel', 'Wheel')), t('sch.k.speed', 'Flight speed')],
    [kbd(l.loupe), t('sch.k.zoom', 'Zoom, while held')],
    [ou(kbd(t('sch.key.pgup', 'Page Up')), kbd(t('sch.key.pgdn', 'Page Down'))), t('sch.k.ceiling', 'Layer ceiling')],
    [ou(kbd('↑'), kbd('↓')), t('sch.k.floor', 'Layer floor')],
    [kbd(l.masquer), t('sch.k.hide', 'Hide the targeted block')],
    [kbd(l.montrer), t('sch.k.show', 'Show hidden blocks again')],
    [kbd(t('sch.key.esc', 'Esc')), t('sch.k.exit', 'Leave flight')],
  ]) + lignes(t('sch.h.out', 'Outside flight'), [
    [kbd(t('sch.key.drag', 'Drag')), t('sch.k.orbit', 'Orbit the schematic')],
    [ou(kbd(t('sch.key.shift', 'Shift')), kbd(t('sch.key.drag', 'Drag')), '+'), t('sch.k.pan', 'Pan the schematic')],
    [kbd(t('sch.key.wheel', 'Wheel')), t('sch.k.wheelzoom', 'Zoom')],
  ]);
}

function majTextes() {
  if (!plan) return;
  const s = plan.modele.taille;
  const m = plan.meta;
  $('viewer-nom').textContent = m.nom;
  $('sch-arbre-nom').textContent = m.nom;
  $('viewer-dims').textContent = `${s.x} × ${s.y} × ${s.z}`;
  $('viewer-blocs').textContent = nombre(m.blocs);
  $('viewer-auteur').textContent = m.auteur || '?';
  const regions = Number(m.regions) || 1;
  const r = document.querySelector('[data-i18n="sch.region"]');
  if (r) r.textContent = regions === 1 ? t('sch.region', '1 region') : `${regions} ${t('sch.regions', 'regions')}`;
  $('viewer-date').textContent = m.modifie
    ? new Intl.DateTimeFormat(t('locale', 'en-GB'), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(m.modifie))
    : '';
  $('viewer-visibles').textContent = `${nombre(plan.modele.n)} ${t('sch.visible', 'blocks visible')}`;
  $('viewer-faces').textContent = stats ? `${plan.version} · ${nombre(stats.faces)} faces` : plan.version;
  $('vw-fly-t').textContent = moteur && moteur.vol.actif ? t('sch.flyexit', 'Leave flight') : t('sch.fly', 'Free flight');
  majTouches();
  majAide();
  majMateriaux();
}

/**
 * Tous les matériaux, du plus nombreux au moins nombreux, filtrables — le
 * panneau de l'application. Chaque ligne montre la vraie texture du bloc,
 * prise dans la planche du plan : la face avant pour un cube, le dessus pour
 * un bloc plat (répéteur, rail…).
 */
function majMateriaux() {
  const liste = $('mats-list');
  if (!liste || !plan) return;
  const f = $('mats-filtre').value.trim().toLowerCase();
  const tous = plan.materiaux;
  const mats = f ? tous.filter((x) => x.label.toLowerCase().includes(f)) : tous;
  const max = tous.length ? tous[0].n : 1;
  const cases = plan.cases;
  const tuile = (nom) => {
    const i = plan.palette.findIndex((p) => p.name === nom);
    const e = i >= 0 ? plan.etats[i] : null;
    const fa = e && e.boites && e.boites[0] && e.boites[0].faces;
    if (!fa) return null;
    const ordre = e.cube ? ['north', 'south', 'east', 'west', 'up', 'down'] : ['up', 'north', 'south', 'east', 'west', 'down'];
    for (const d of ordre) if (fa[d] && plan.textures[fa[d].tex] !== undefined) return plan.textures[fa[d].tex];
    return null;
  };
  liste.style.setProperty('--atlas', `url("${plan.atlas}")`);
  liste.replaceChildren(...mats.map((x) => {
    const li = document.createElement('li');
    const ico = document.createElement('span');
    ico.className = `mat-ico${/redstone_wire$/.test(x.nom) ? ' mat-red' : ''}`;
    ico.style.setProperty('--cases', String(cases));
    const tu = tuile(x.nom);
    if (tu != null) { ico.style.setProperty('--tx', tu % cases); ico.style.setProperty('--ty', Math.floor(tu / cases)); }
    const nom = Object.assign(document.createElement('span'), { className: 'mat-nom', textContent: x.label, title: x.nom });
    const n = Object.assign(document.createElement('span'), { className: 'mat-n', textContent: nombre(x.n) });
    const barre = Object.assign(document.createElement('span'), { className: 'mat-bar' });
    const i = document.createElement('i');
    i.style.width = `${Math.max(2, Math.round((x.n / max) * 100))}%`;
    barre.append(i);
    li.append(ico, nom, n, barre);
    return li;
  }));
  $('mats-types').textContent = nombre(tous.length);
}

function message(texte) {
  const m = $('viewer-msg');
  m.textContent = texte;
  m.hidden = false;
}

/* ------------------------------------------------------------ maintenance */

/*
 * L'image de secours, rendue par le moteur lui-même.
 *
 * Sur le site servi en local (pas en double-clic), faire défiler jusqu'au
 * visionneur puis, dans la console du navigateur : `await kubicVue.affiche()`.
 * Le navigateur télécharge <nom>.webp en 1600 × 900, au cadrage d'accueil :
 * à poser dans assets/viewer/.
 */
window.kubicVue = {
  async affiche(L = 1600, H = 900) {
    if (!plan) throw new Error('le plan n’est pas chargé : faites d’abord défiler jusqu’au visionneur');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const hote = document.createElement('div');
    hote.style.cssText = `position:fixed;left:-20000px;top:0;width:${L / dpr}px;height:${H / dpr}px`;
    const c = document.createElement('canvas');
    c.style.cssText = 'width:100%;height:100%;display:block';
    hote.append(c);
    document.body.append(hote);
    const m = new Moteur(c);
    m.couleurFond([16 / 255, 16 / 255, 20 / 255]);
    await m.charger(plan);
    m.cadrer(LACET, TANGAGE);
    m.camera.distance *= RAPPROCHE;
    m.dessiner();
    const lien = Object.assign(document.createElement('a'), {
      href: c.toDataURL('image/webp', 0.86),
      download: `${PLAN.split('/').pop()}.webp`,
    });
    lien.click();
    m.detruire();
    hote.remove();
  },
};
