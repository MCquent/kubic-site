/*
 * Copie du moteur de l'application (serveur manager/renderer/js/schematics/
 * moteur3d.js, et maillage.js à côté), pour la démonstration du site.
 * Une seule différence : `this.clavier`, qui laisse la page décider quand le
 * moteur écoute le clavier. Dans l'application il écoute toujours ; sur le
 * site, seulement quand le visionneur est actif — sinon la touche F, et même
 * Ctrl+F, basculeraient le vol pendant qu'on lit la page.
 * À recopier de l'application quand le moteur y change, en gardant ce point.
 *
 * Le moteur de rendu.
 *
 * Une texture, un shader, un tampon par étage : c'est ce qui permet à une
 * ferme de cent cinquante mille blocs de tourner sans saccade. La caméra ne
 * touche jamais à la géométrie ; elle ne change qu'une matrice.
 *
 * La découpe par couches mérite un mot. Elle pourrait se faire en refabriquant
 * le maillage à chaque cran du curseur — une seconde d'attente à chaque fois —
 * ou en jetant les fragments hors tranche dans le shader, ce qui les fait quand
 * même transiter par la carte. Ici les étages sont des tampons distincts : on
 * ne dessine que ceux de la tranche. La coupe est exacte par construction,
 * elle tombe entre deux couches et jamais au milieu d'un bloc, et regarder le
 * premier étage d'un plan de vingt-trois coûte vingt-trois fois moins cher que
 * de le regarder en entier.
 */

import { construire, PAS } from './maillage.js';

/* Les six tampons d'un étage, dans l'ordre où le maillage les range. */
const TAMPONS = ['opaque', 'translucide', 'basOpaque', 'basTranslucide', 'hautOpaque', 'hautTranslucide'];

/**
 * La sensibilité de la souris, telle que le jeu la calcule.
 *
 * Minecraft ne multiplie pas linéairement : il prend s × 0,6 + 0,2, élève au
 * cube, multiplie par huit, et tourne alors de 0,15 degré par pixel. La courbe
 * est molle au centre et vive aux extrêmes ; la reproduire à l'identique est
 * le seul moyen qu'un réglage de 100 % rende ici le geste qu'il rend là-bas.
 * `s` va de 0 à 1, et 0,5 est le défaut du jeu — ce que sa fenêtre appelle
 * cent pour cent.
 */
export function facteurSensi(s) {
  const d = s * 0.6 + 0.2;
  return d * d * d * 8 * 0.15 * (Math.PI / 180);
}

/**
 * Le regard bute juste avant la verticale.
 *
 * Le jeu s'arrête à quatre-vingt-dix degrés pile. Ici la matrice de vue se
 * construit à partir d'un vecteur « haut » : à la verticale exacte il devient
 * parallèle au regard, le produit vectoriel s'annule et l'image disparaît. Un
 * millième de radian avant — un vingtième de degré — ne se voit pas.
 */
const PENTE_MAX = Math.PI / 2 - 0.001;

/**
 * La vitesse de vol la plus haute, en blocs par seconde.
 *
 * Elle borne la molette autant que le curseur de la fenêtre, qui la reprend :
 * les deux disent la même chose, et un seul chiffre les tient. Cent blocs par
 * seconde traversent une ferme de deux cent soixante étages en moins de trois
 * secondes, ce qui est le geste que Quentin demandait.
 */
export const VITESSE_MAX = 100;

/**
 * Le champ de vision en vol, et ce que la loupe en retranche.
 *
 * Soixante-dix degrés est celui du jeu : quarante-cinq, plus sage pour
 * examiner un plan de loin, donne l'impression de regarder par un tube dès
 * qu'on entre dedans. La loupe le divise par quatre — c'est le grossissement
 * qu'on a l'habitude d'avoir sous la main, assez pour lire une inscription à
 * trente blocs sans perdre le sens de l'espace.
 */
const FOV_VOL = (70 * Math.PI) / 180;
const LOUPE = 4;

/**
 * Les lettres du vol, par disposition de clavier.
 *
 * Un `code` de touche désigne une **position**, pas une lettre : `KeyW` est le
 * coin haut gauche du bloc de déplacement, qui porte un W en QWERTY et un Z en
 * AZERTY. Choisir « azerty » ou « qwerty » ne peut donc pas se dire en codes —
 * ce serait le même. Cela se dit en **lettres voulues**, que l'on résout
 * ensuite en positions sur le clavier réellement branché.
 *
 * Ainsi, sur un clavier français, « azerty » donne le bloc Z Q S D sous les
 * doigts, et « qwerty » donne les touches **marquées** W A S D — c'est le
 * choix que proposent les jeux, et il a un sens dans les deux cas.
 */
export const DISPOSITIONS = {
  azerty: { avant: 'Z', gauche: 'Q', arriere: 'S', droite: 'D', infos: 'A', loupe: 'C', masquer: 'E', montrer: 'X' },
  qwerty: { avant: 'W', gauche: 'A', arriere: 'S', droite: 'D', infos: 'Q', loupe: 'C', masquer: 'E', montrer: 'X' },
};
export const DISPO_DEFAUT = 'azerty';

/**
 * Les positions qui portent ces lettres, sur ce clavier-ci.
 *
 * Le navigateur sait ce que porte chaque position ; on renverse sa table. S'il
 * ne répond pas — la table n'est pas partout —, on suppose un clavier QWERTY,
 * où la lettre X est à la position `KeyX`.
 */
export async function codesDe(dispo) {
  const lettres = DISPOSITIONS[dispo] || DISPOSITIONS[DISPO_DEFAUT];
  let vers = null;
  try {
    const plan = await navigator.keyboard.getLayoutMap();
    vers = new Map();
    for (const [code, glyphe] of plan) {
      const g = String(glyphe).toUpperCase();
      if (/^[A-Z]$/.test(g) && !vers.has(g)) vers.set(g, code);
    }
  } catch { /* pas de table : on s'en tient au QWERTY supposé */ }
  const out = {};
  for (const [role, lettre] of Object.entries(lettres)) {
    out[role] = (vers && vers.get(lettre)) || `Key${lettre}`;
  }
  return out;
}

/* ------------------------------------------------------------- matrices */

function perspective(fov, aspect, pres, loin) {
  const f = 1 / Math.tan(fov / 2);
  const d = 1 / (pres - loin);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (loin + pres) * d, -1,
    0, 0, 2 * loin * pres * d, 0,
  ]);
}

function regarder(oeil, cible, haut) {
  const z = norme([oeil[0] - cible[0], oeil[1] - cible[1], oeil[2] - cible[2]]);
  const x = norme(croix(haut, z));
  const y = croix(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -point(x, oeil), -point(y, oeil), -point(z, oeil), 1,
  ]);
}

function multiplier(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  }
  return o;
}

const croix = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const point = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norme(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/* -------------------------------------------------------------- shaders */

const SOMMET = `#version 300 es
in vec3 aPos;
in vec2 aUV;
in float aCouche;
in vec4 aCouleur;
uniform mat4 uMVP;
uniform float uEchelle;
uniform float uMarge;
out vec2 vUV;
out float vCouche;
out vec4 vCouleur;
out float vDist;
void main() {
  vUV = aUV;
  vCouche = aCouche;
  vCouleur = aCouleur;
  vec4 p = uMVP * vec4(aPos * uEchelle - uMarge, 1.0);
  vDist = p.w;
  gl_Position = p;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUV;
in float vCouche;
in vec4 vCouleur;
in float vDist;
#ifdef TABLEAU
uniform sampler2DArray uTuiles;
#else
uniform sampler2D uAtlas;
uniform float uCases;
#endif
uniform float uSommet;
uniform float uVoile;
uniform vec3 uFond;
uniform float uBrume;
out vec4 sortie;

vec4 lire() {
#ifdef TABLEAU
  return texture(uTuiles, vec3(vUV, vCouche));
#else
  // Atlas plat : la tuile se retrouve par une division, et les coordonnées
  // locales s'y replient. Sans mipmaps — les tuiles voisines baveraient.
  float c = floor(vCouche + 0.5);
  vec2 base = vec2(mod(c, uCases), floor(c / uCases)) / uCases;
  return texture(uAtlas, base + vUV / uCases);
#endif
}

void main() {
  vec3 c;
  float a = 1.0;
  if (vCouleur.a < 0.5) {
    // Bloc que le jeu dessine comme une entité : sa couleur moyenne suffit.
    c = vCouleur.rgb;
  } else {
    vec4 t = lire();
    if (uVoile > 0.5) {
      // Passe translucide : la vitre garde son alpha et se mélange au fond.
      if (t.a < 0.03) discard;
      a = t.a;
    } else if (t.a < 0.1) {
      /*
       * Découpe des feuillages, torches, grilles — au seuil du jeu, un
       * dixième, et non un sixième. Une texture ajourée s'amincit dans ses
       * niveaux de détail : la moyenne d'alpha d'un fil de redstone, qui couvre
       * un huitième de sa tuile, tombe à 0,125. Au-dessus, il était jeté dès
       * qu'on s'éloignait, et le fil disparaissait en reculant la caméra.
       */
      discard;
    }
    c = t.rgb * vCouleur.rgb;
  }

  // L'étage du dessus s'éclaire, pour qu'on suive la coupe des yeux.
  c = mix(c, vec3(1.0), uSommet * 0.2);

  // Un voile léger au loin : sans lui une grande structure devient illisible.
  sortie = vec4(mix(c, uFond, clamp(vDist * uBrume, 0.0, 0.55)), a);
}`;

/*
 * Le contour du bloc visé.
 *
 * Un programme à part, minuscule : le shader principal lit un atlas et porte
 * huit uniformes dont aucun ne sert ici. Douze arêtes, une couleur unie, la
 * même matrice — c'est tout ce qu'il faut, et cela évite de faire passer un
 * cas particulier dans le chemin qui dessine deux millions de faces.
 */
const SOMMET_CONTOUR = `#version 300 es
in vec3 aP;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aP, 1.0); }`;

const FRAGMENT_CONTOUR = `#version 300 es
precision highp float;
uniform vec4 uCouleur;
out vec4 sortie;
void main() { sortie = uCouleur; }`;

/** Insère les définitions après la ligne de version, seule place permise. */
function avec(src, defs) {
  const i = src.indexOf('\n') + 1;
  return src.slice(0, i) + defs.map((d) => `#define ${d}\n`).join('') + src.slice(i);
}

function compiler(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const j = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`shader : ${j}`);
  }
  return s;
}

/* --------------------------------------------------------------- moteur */

export class Moteur {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, depth: true, powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL 2 indisponible');
    const gl = this.gl;

    /*
     * Deux façons de ranger les textures.
     *
     * Un **tableau de tuiles** est ce qu'on veut : chaque texture y a ses
     * propres niveaux réduits, si bien qu'une structure vue de loin s'adoucit
     * au lieu de fourmiller. Sur un atlas plat, ces niveaux mélangeraient les
     * tuiles voisines — de la pierre dans le verre — et sont donc interdits.
     *
     * Mais un tableau a une profondeur maximale, que la norme ne garantit qu'à
     * 256 couches. Les cartes de bureau en offrent 2048 ; sur celles qui n'en
     * ont pas assez, on retombe sur l'atlas plat, net et sans mipmaps. Le
     * maillage est le même dans les deux cas : seul le shader diffère.
     */
    this.tableau = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) >= 2048;
    this._construireProgramme();

    /*
     * La texture n'est créée qu'au moment où on sait quoi y mettre.
     *
     * Un objet texture prend son type au premier `bindTexture` et le garde à
     * vie. En le créant ici et en le liant dès la première image — celle que
     * provoque un simple changement de couleur de fond, avant même que l'atlas
     * soit lu — on le figeait en texture plate ; l'atlas tentait ensuite de s'y
     * installer en tableau de tuiles, OpenGL refusait, et tout devenait noir
     * opaque. Le défaut ne se voyait qu'une fois sur deux, selon qui de l'image
     * ou du chargement arrivait le premier.
     */
    this.cibleTex = gl.TEXTURE_2D;
    this.cases = 1;
    this.texture = null;
    this.etages = [];
    this.echelle = 1;
    this.marge = 0;
    this.hauteur = 0;

    /*
     * Le masquage.
     *
     * `modele` est gardé pour pouvoir rebâtir un étage sans tout relire —
     * c'est la même donnée que celle du chargement, on n'en fait pas de copie.
     * `masques` porte un octet par emplacement, et `salis` retient les
     * étages déjà touchés : au moment de tout remontrer, ce sont exactement
     * ceux qu'il faut refaire, et aucun autre.
     */
    this.modele = null;
    this.masques = null;
    this.salis = new Set();
    this.vise = null;
    this.contour = null;

    /*
     * Les faces arrière ne se dessinent pas, comme dans le jeu.
     *
     * On les gardait de peur de perdre les plans uniques — herbes, rails, fils.
     * La crainte était mal fondée : le jeu les supprime, lui, et ses modèles en
     * tiennent compte. Sur les 791 faces posées sur un élément plat, 724
     * déclarent leur opposée ; les 67 restantes — dessus des pousses de mer,
     * intérieur des étagères, feu, `single_face` — sont unilatérales à dessein
     * et ne se voient de dos ni ici ni là-bas.
     *
     * Les garder coûtait cher au verre : un cube de vitre montrait ses six
     * faces au lieu de trois, la teinte comptait double et les arêtes du fond
     * se voyaient au travers. On avait un aquarium vide au lieu d'une vitre.
     *
     * Le sens de parcours vient de `COINS` : vu du dehors, un quad y tourne
     * dans le sens des aiguilles. C'est l'inverse de la convention par défaut,
     * d'où le `frontFace` explicite.
     */
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CW);
    gl.cullFace(gl.BACK);
    gl.enable(gl.DEPTH_TEST);

    /*
     * Le champ de vision est réglable : le jeu emploie 70° à la verticale,
     * et comparer mon rendu au sien demande de viser pareil. Quarante-cinq
     * degrés restent le défaut — moins de déformation sur un plan qu on
     * regarde de près.
     */
    this.camera = { lacet: -0.7, tangage: 0.5, distance: 40, cible: [0, 0, 0], fov: Math.PI / 4 };
    this.coupe = { min: 0, max: 0 };
    this.fond = [0.055, 0.06, 0.07];
    this.aDessiner = false;
    this.stats = { faces: 0, cullees: 0, maillage: 0, octets: 0 };
    this.surImage = null;

    /*
     * Le vol libre.
     *
     * L'orbite convient pour tourner autour d'un plan ; elle devient pénible
     * dès qu'on veut entrer dedans. On ne change pourtant pas de caméra : on
     * déplace la **cible**, et l'œil, qui en dépend, suit exactement le même
     * mouvement. La distance reste ce qu'elle est — le pivot avance devant
     * nous, et cela ne se voit pas.
     */
    this.vol = {
      actif: false, vitesse: 8, sensi: 0.5, touches: new Set(), dernier: 0, boucle: 0, loupe: 1,
    };
    this.surVol = null;
    this.surVitesse = null;
    /*
     * La tranche, quand c'est le clavier qui l'a changée.
     *
     * La fenêtre garde ses deux curseurs et son étiquette ; il faut donc
     * qu'elle sache que la coupe a bougé sans elle, comme pour la vitesse à la
     * molette. Ce n'est appelé que dans ce sens : `tranche()` appelée depuis la
     * fenêtre ne se retourne pas vers elle.
     */
    this.surTranche = null;
    /*
     * Le bloc visé, quand il change.
     *
     * Appelé au plus une fois par image, et seulement si la visée a bougé —
     * la fenêtre n'a pas à réécrire son étiquette soixante fois par seconde
     * pour afficher le même nom.
     */
    this.surVisee = null;
    this._visee = '';
    /*
     * Où s'écrit ce que l'on vise.
     *
     * Sous le réticule, c'est là où l'œil est déjà — mais cela recouvre
     * justement ce qu'on regarde. Dans le coin, cela ne gêne rien mais demande
     * un aller-retour du regard. Aucune des deux ne l'emporte : on bascule.
     */
    this.infosEnHaut = false;
    /* Site : la page dit si le clavier est pour le moteur (voir l'en-tête). */
    this.clavier = () => true;
    this.surInfos = null;
    /*
     * Les positions qui commandent le vol, résolues depuis les lettres.
     *
     * Posées en dur au départ pour que le clavier réponde avant même que la
     * table de disposition soit revenue — elle est asynchrone. `disposition()`
     * les remplace dès qu'on sait.
     */
    this.codes = {
      avant: 'KeyW', gauche: 'KeyA', arriere: 'KeyS', droite: 'KeyD', infos: 'KeyQ', loupe: 'KeyC',
    };

    this._brancher();
  }

  /**
   * Compile le programme pour la manière de ranger les textures retenue.
   * Refait si la carte finit par refuser le tableau de tuiles : le shader doit
   * alors échantillonner un atlas plat, pas un tableau.
   */
  _construireProgramme() {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    const p = gl.createProgram();
    gl.attachShader(p, compiler(gl, gl.VERTEX_SHADER, SOMMET));
    gl.attachShader(p, compiler(gl, gl.FRAGMENT_SHADER,
      this.tableau ? avec(FRAGMENT, ['TABLEAU']) : FRAGMENT));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`lien : ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    this.loc = {
      pos: gl.getAttribLocation(p, 'aPos'),
      uv: gl.getAttribLocation(p, 'aUV'),
      couche: gl.getAttribLocation(p, 'aCouche'),
      couleur: gl.getAttribLocation(p, 'aCouleur'),
      mvp: gl.getUniformLocation(p, 'uMVP'),
      echelle: gl.getUniformLocation(p, 'uEchelle'),
      marge: gl.getUniformLocation(p, 'uMarge'),
      atlas: gl.getUniformLocation(p, this.tableau ? 'uTuiles' : 'uAtlas'),
      cases: gl.getUniformLocation(p, 'uCases'),
      sommet: gl.getUniformLocation(p, 'uSommet'),
      voile: gl.getUniformLocation(p, 'uVoile'),
      fond: gl.getUniformLocation(p, 'uFond'),
      brume: gl.getUniformLocation(p, 'uBrume'),
    };
  }

  /**
   * Le programme du contour, sa boîte de douze arêtes, et son tampon.
   *
   * Les sommets sont réécrits à chaque changement de cible — vingt-quatre
   * points, rien qui vaille de garder une boîte par bloc. Ils sont en
   * coordonnées de blocs, comme la matrice les attend : le shader principal
   * décode ses entiers courts, celui-ci n'a rien à décoder.
   */
  _construireContour() {
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, compiler(gl, gl.VERTEX_SHADER, SOMMET_CONTOUR));
    gl.attachShader(p, compiler(gl, gl.FRAGMENT_SHADER, FRAGMENT_CONTOUR));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`lien contour : ${gl.getProgramInfoLog(p)}`);
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const aP = gl.getAttribLocation(p, 'aP');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, 24 * 3 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.contour = {
      prog: p, vao, vbo,
      mvp: gl.getUniformLocation(p, 'uMVP'),
      couleur: gl.getUniformLocation(p, 'uCouleur'),
      sommets: new Float32Array(24 * 3),
      clef: '',
    };
  }

  /**
   * Écrit les douze arêtes du cube d'un emplacement dans le tampon.
   *
   * La boîte est **élargie de trois millièmes de bloc**. Sans ce jeu, l'arête
   * partage exactement son plan avec la face qu'elle souligne : les deux se
   * disputent la profondeur et le trait se met à clignoter par segments selon
   * l'angle. C'est le même écart que prend le jeu autour du bloc visé.
   */
  _poserContour(v) {
    const gl = this.gl;
    const c = this.contour;
    const e = 0.003;
    const x0 = v.x - e; const y0 = v.y - e; const z0 = v.z - e;
    const x1 = v.x + 1 + e; const y1 = v.y + 1 + e; const z1 = v.z + 1 + e;
    const s = c.sommets;
    let k = 0;
    const trait = (ax, ay, az, bx, by, bz) => {
      s[k++] = ax; s[k++] = ay; s[k++] = az;
      s[k++] = bx; s[k++] = by; s[k++] = bz;
    };
    for (const y of [y0, y1]) {
      trait(x0, y, z0, x1, y, z0);
      trait(x1, y, z0, x1, y, z1);
      trait(x1, y, z1, x0, y, z1);
      trait(x0, y, z1, x0, y, z0);
    }
    for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) trait(x, y0, z, x, y1, z);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, s);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /* ------------------------------------------------------------ entrées */

  _brancher() {
    const c = this.canvas;
    let bouton = -1;
    let ax = 0;
    let ay = 0;

    /*
     * En vol, la souris est capturée et les gestes d'orbite n'ont plus cours.
     *
     * Mais la capture exige un vrai clic, et le navigateur peut la refuser. On
     * la retente alors au premier clic dans la toile — celui-là en est un —, et
     * en attendant le glissement fait tourner le regard. Mieux vaut un geste de
     * secours qu'un vol à l'aveugle.
     */
    const capturee = () => document.pointerLockElement === c;
    const enOrbite = () => !this.vol.actif || !capturee();

    c.addEventListener('pointerdown', (e) => {
      bouton = e.button;
      if (this.vol.actif && !capturee()) { try { c.requestPointerLock(); } catch { /* refusée */ } }
      if (!enOrbite()) return;
      ax = e.clientX; ay = e.clientY;
      try { c.setPointerCapture(e.pointerId); } catch { /* souris déjà prise */ }
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!enOrbite()) return;
      if (bouton < 0) return;
      const dx = e.clientX - ax;
      const dy = e.clientY - ay;
      ax = e.clientX; ay = e.clientY;
      if (bouton === 0 && !e.shiftKey) {
        if (this.vol.actif) {
          /* Secours sans capture : le glissement tourne la tête, pas l'orbite. */
          const k = facteurSensi(this.vol.sensi) / this.vol.loupe;
          this._tourner(-dx * k, dy * k);
        } else {
          this.camera.lacet -= dx * 0.008;
          this.camera.tangage = Math.max(-PENTE_MAX, Math.min(PENTE_MAX, this.camera.tangage + dy * 0.008));
        }
      } else {
        // Le glissement suit le plan de l'écran, sinon on perd la structure.
        const k = this.camera.distance * 0.0016;
        const l = this.camera.lacet;
        const t = this.camera.tangage;
        this.camera.cible[0] -= (Math.cos(l) * dx + Math.sin(l) * Math.sin(t) * dy) * k;
        this.camera.cible[1] += Math.cos(t) * dy * k;
        this.camera.cible[2] += (Math.sin(l) * dx - Math.cos(l) * Math.sin(t) * dy) * k;
      }
      this.demander();
    });
    const relacher = (e) => {
      bouton = -1;
      try { c.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    };
    c.addEventListener('pointerup', relacher);
    c.addEventListener('pointercancel', relacher);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.vol.actif) {
        /*
         * En vol, la souris est capturée : la molette est le seul réglage qui
         * reste sous la main. Elle change donc la vitesse, pas la distance —
         * sans quoi on volerait enfermé dans l'allure choisie au départ.
         *
         * Le pas suit la vitesse : un cran vaut un quart de plus ou un
         * cinquième de moins, arrondi de façon à bouger d'au moins un bloc par
         * seconde. Un pas fixe serait grossier à 3 et dérisoire à 50.
         */
        const brut = this.vol.vitesse * (e.deltaY < 0 ? 1.25 : 0.8);
        const v = Math.max(1, Math.min(VITESSE_MAX, e.deltaY < 0 ? Math.ceil(brut) : Math.floor(brut)));
        if (v !== this.vol.vitesse) {
          this.vol.vitesse = v;
          if (this.surVitesse) this.surVitesse(v);
        }
        return;
      }
      this.camera.distance = Math.max(1.5, Math.min(6000, this.camera.distance * Math.exp(e.deltaY * 0.0012)));
      this.demander();
    }, { passive: false });

    /*
     * Le clavier, lu en **positions** plutôt qu'en lettres.
     *
     * `code` désigne une touche par sa place : `KeyW` est celle du coin haut
     * gauche du bloc de déplacement — le Z d'un clavier français, le W d'un
     * clavier anglais. Lire `key` aurait obligé à énumérer les dispositions
     * une par une, et à oublier toutes les autres.
     */
    /*
     * Qui a le droit de garder une lettre pour lui.
     *
     * Seuls les champs où l'on **écrit** : une zone de texte, une liste
     * déroulante — où les lettres sautent à l'option qui commence par elles —
     * et tout ce qui est éditable. Un curseur, une case à cocher, un bouton
     * n'ont que faire d'un « F », et les traiter comme une saisie rendait la
     * touche du vol libre muette dès qu'on avait touché au curseur de vitesse
     * ou à celui des couches : le focus restait dessus, et le raccourci
     * s'arrêtait là.
     *
     * Le vol n'emploie que W, A, S, D, Espace et Contrôle ; aucune n'est utile
     * à un curseur, qui se commande aux flèches. Les laisser passer ne prend
     * donc rien à personne.
     */
    const SANS_TEXTE = /^(range|checkbox|radio|button|submit|reset|color|file|image)$/i;
    const saisie = (e) => {
      const c2 = e.target || {};
      if (c2.isContentEditable) return true;
      if (c2.tagName === 'TEXTAREA' || c2.tagName === 'SELECT') return true;
      return c2.tagName === 'INPUT' && !SANS_TEXTE.test(c2.type || 'text');
    };
    const bas = (e) => {
      if (c.hidden || saisie(e) || !this.clavier(e)) return;
      if (e.code === 'KeyF' && !e.repeat) { e.preventDefault(); this.voler(!this.vol.actif); return; }
      if (!this.vol.actif) return;
      /*
       * La tranche au clavier, et seulement en vol.
       *
       * On travaille par les deux bouts : **Page haut** et **Page bas** font
       * monter et descendre le plafond de la coupe, les **flèches** son
       * plancher. C'est le geste qu'on a quand on inspecte une ferme de
       * l'intérieur — on découvre par le haut ou on remonte depuis le bas sans
       * lâcher le vol pour aller chercher un curseur à la souris.
       *
       * La répétition est admise : on garde la touche enfoncée pour défiler.
       * Chaque borne s'arrête sur l'autre plutôt que de la pousser, sans quoi
       * remonter le plancher emmènerait le plafond avec lui.
       */
      /*
       * La loupe, tant qu'on tient la touche.
       *
       * Le champ se resserre et la sensibilité de la souris suit : sans cela,
       * un même geste balaie quatre fois plus de paysage et l'on ne vise plus
       * rien. C'est ce que font tous les zooms de jeu, et l'oublier se sent
       * immédiatement.
       */
      if (e.code === this.codes.loupe) {
        e.preventDefault();
        if (!e.repeat && this.vol.loupe === 1) {
          this.vol.loupe = LOUPE;
          this.camera.fov = FOV_VOL / LOUPE;
          this.demander();
        }
        return;
      }
      /*
       * Masquer ce que l'on vise, et tout remontrer.
       *
       * Sans répétition : `e.repeat` ferait disparaître une colonne entière
       * en tenant la touche, et chaque disparition coûte un rebâtissage.
       */
      if (e.code === this.codes.masquer && !e.repeat) {
        e.preventDefault();
        const v = this.viser();
        if (v && this.masquer(v.x, v.y, v.z) && this.surMasques) this.surMasques(this.nbMasques());
        return;
      }
      if (e.code === this.codes.montrer && !e.repeat) {
        e.preventDefault();
        const n = this.demasquer();
        if (n && this.surMasques) this.surMasques(0);
        return;
      }
      /* Où s'écrit ce que l'on vise : sous le réticule, ou dans le coin. */
      if (e.code === this.codes.infos && !e.repeat) {
        e.preventDefault();
        this.infosEnHaut = !this.infosEnHaut;
        if (this.surInfos) this.surInfos(this.infosEnHaut);
        return;
      }
      const cran = { PageUp: ['max', 1], PageDown: ['max', -1], ArrowUp: ['min', 1], ArrowDown: ['min', -1] }[e.code];
      if (cran) {
        e.preventDefault();
        const [borne, pas] = cran;
        const v = this.coupe[borne] + pas;
        const min = borne === 'min' ? Math.min(v, this.coupe.max) : this.coupe.min;
        const max = borne === 'max' ? Math.max(v, this.coupe.min) : this.coupe.max;
        const avant = `${this.coupe.min}:${this.coupe.max}`;
        this.tranche(min, max);
        if (`${this.coupe.min}:${this.coupe.max}` !== avant && this.surTranche) {
          this.surTranche(this.coupe.min, this.coupe.max);
        }
        return;
      }
      this.vol.touches.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    const haut = (e) => {
      this.vol.touches.delete(e.code);
      /* La loupe se relâche avec sa touche, même si le vol s'est arrêté entre-temps. */
      if (e.code === this.codes.loupe && this.vol.loupe !== 1) {
        this.vol.loupe = 1;
        if (this.vol.actif) this.camera.fov = FOV_VOL;
        this.demander();
      }
    };
    /* La souris relâchée hors de la fenêtre laisserait des touches coincées. */
    const oubli = () => this.vol.touches.clear();

    /* Souris capturée : on regarde autour de soi sans tenir de bouton. */
    c.addEventListener('mousemove', (e) => {
      if (!this.vol.actif || document.pointerLockElement !== c) return;
      const k = facteurSensi(this.vol.sensi) / this.vol.loupe;
      this._tourner(-e.movementX * k, e.movementY * k);
      this.demander();
    });
    /* Échap rend la souris : on quitte le vol du même geste. */
    const verrou = () => { if (this.vol.actif && document.pointerLockElement !== c) this.voler(false); };

    window.addEventListener('keydown', bas);
    window.addEventListener('keyup', haut);
    window.addEventListener('blur', oubli);
    document.addEventListener('pointerlockchange', verrou);
    this._ecoutes = { bas, haut, oubli, verrou };
  }

  /* ------------------------------------------------------------ contenu */

  /** Charge l'atlas puis le maillage. */
  async charger(m) {
    const gl = this.gl;
    await this._atlas(m.atlas, m.cases, m.cote || 16);
    this._viderEtages();

    const t0 = performance.now();
    const maille = construire(m);
    const tMaillage = Math.round(performance.now() - t0);
    this.echelle = maille.echelle;
    this.marge = maille.marge;

    const t1 = performance.now();
    /*
     * Six tampons par étage. Les quatre derniers ne servent qu'aux deux bords
     * de la tranche : ils portent les faces qu'un voisin cachait et que la
     * coupe vient de découvrir.
     */
    for (const e of maille.etages) {
      if (!e) { this.etages.push(null); continue; }
      const t = { y: e.y };
      for (const nom of TAMPONS) t[nom] = e[nom] ? this._televerser(e[nom]) : null;
      this.etages.push(t);
    }
    this.stats = {
      faces: maille.faces,
      translucides: maille.translucides,
      cullees: maille.cullees,
      maillage: tMaillage,
      televersement: Math.round(performance.now() - t1),
      octets: maille.octets,
      etages: this.etages.filter(Boolean).length,
    };

    const t = m.modele.taille;
    this.modele = m;
    this.hauteur = t.y;
    this.taille = t;
    this.coupe = { min: 0, max: t.y - 1 };
    /*
     * Une grille d'états, pour savoir ce que la caméra vise.
     *
     * Le maillage transforme les blocs en triangles et n'en garde rien
     * d'interrogeable. Un réticule a pourtant besoin de la question inverse :
     * quel bloc y a-t-il au bout de ce rayon ? On garde donc un entier court
     * par emplacement — le numéro de son état, zéro pour le vide. Sur la plus
     * grosse ferme de la bibliothèque cela fait quatre méga-octets et demi, à
     * côté des cent quatre-vingts du maillage.
     */
    const volume = t.x * t.y * t.z;
    this.grille = null;
    if (volume > 0 && volume < 64 * 1024 * 1024) {
      const g = new Uint16Array(volume);
      const p = m.modele.positions;
      const e = m.modele.etats;
      for (let i = 0; i < m.modele.n; i++) {
        g[(((p[i * 3 + 1] * t.z) + p[i * 3 + 2]) * t.x) + p[i * 3]] = e[i];
      }
      this.grille = g;
      /* Rien de masqué au départ ; la table suit la grille, ou n'existe pas. */
      this.masques = new Uint8Array(volume);
      this.salis.clear();
    }
    this.cadrer();
    return this.stats;
  }

  /* ------------------------------------------------------------ masquage */

  /**
   * Fait disparaître un emplacement.
   *
   * Le bloc cesse d'exister pour tout le monde : il n'émet plus ses faces, et
   * il ne cache plus celles de ses voisins — sans quoi le trou laisserait voir
   * l'envers de la structure au lieu de son intérieur. C'est pour cela qu'on
   * rebâtit **trois** étages et non un : les faces révélées appartiennent aux
   * voisins, qui sont au plus un étage au-dessus ou au-dessous.
   *
   * @returns {boolean} vrai si quelque chose a changé.
   */
  masquer(x, y, z) {
    if (!this.masques || !this.grille || !this.taille) return false;
    const t = this.taille;
    if (x < 0 || y < 0 || z < 0 || x >= t.x || y >= t.y || z >= t.z) return false;
    const i = (((y * t.z) + z) * t.x) + x;
    if (this.masques[i] || !this.grille[i]) return false;
    this.masques[i] = 1;
    /* La grille sert au réticule : un bloc masqué ne doit plus se viser. */
    this.grille[i] = 0;
    this._rebatir(y);
    return true;
  }

  /** Combien d'emplacements sont masqués. */
  nbMasques() {
    if (!this.masques) return 0;
    let n = 0;
    for (let i = 0; i < this.masques.length; i++) if (this.masques[i]) n++;
    return n;
  }

  /**
   * Remontre tout.
   *
   * On ne rebâtit que les étages qu'on avait touchés — c'est ce que `salis`
   * retient. Sur la ferme à shulkers, tout refaire coûterait la seconde entière
   * du chargement ; ici, quelques dizaines de millisecondes par étage visité.
   *
   * @returns {number} combien d'emplacements sont revenus.
   */
  demasquer() {
    if (!this.masques) return 0;
    const n = this.nbMasques();
    if (!n) return 0;
    this.masques.fill(0);
    if (this.modele && this.grille) {
      /* La grille se refait depuis le modèle : c'est elle qui dit ce qu'on vise. */
      const t = this.taille;
      const mo = this.modele.modele;
      for (let k = 0; k < mo.n; k++) {
        const x = mo.positions[k * 3];
        const y = mo.positions[k * 3 + 1];
        const z = mo.positions[k * 3 + 2];
        this.grille[(((y * t.z) + z) * t.x) + x] = mo.etats[k];
      }
      this._rebatirEtages(new Set(this.salis));
    }
    this.salis.clear();
    return n;
  }

  /** Les trois étages qu'un emplacement peut avoir changés. */
  _rebatir(y) {
    const ys = new Set();
    for (let k = y - 1; k <= y + 1; k++) if (k >= 0 && k < this.hauteur) ys.add(k);
    for (const k of ys) this.salis.add(k);
    this._rebatirEtages(ys);
  }

  /**
   * Rebâtit les étages donnés et remplace leurs tampons.
   *
   * Le maillage rend `null` pour tout étage non demandé : c'est « garde le
   * tien », pas « il est vide ». On ne touche donc qu'aux clefs de l'ensemble,
   * et l'on n'oublie pas de rendre à la carte graphique les tampons remplacés.
   */
  _rebatirEtages(ys) {
    if (!ys || !ys.size || !this.modele) return 0;
    const gl = this.gl;
    const t0 = performance.now();
    const maille = construire(this.modele, { masques: this.masques, etages: ys });
    for (const y of ys) {
      const neuf = maille.etages[y];
      const vieux = this.etages[y];
      if (vieux) {
        for (const nom of TAMPONS) {
          const b = vieux[nom];
          if (!b) continue;
          gl.deleteBuffer(b.vbo);
          gl.deleteBuffer(b.ibo);
          gl.deleteVertexArray(b.vao);
        }
      }
      if (!neuf) { this.etages[y] = null; continue; }
      const remplace = { y };
      for (const nom of TAMPONS) remplace[nom] = neuf[nom] ? this._televerser(neuf[nom]) : null;
      this.etages[y] = remplace;
    }
    /* Les voilés se retrient : leurs tampons sont neufs, l'ordre est perdu. */
    this._bornesEtages = null;
    this.demander();
    return Math.round(performance.now() - t0);
  }

  _televerser(e) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, e.tampon, gl.STATIC_DRAW);
    const { loc } = this;
    gl.enableVertexAttribArray(loc.pos);
    gl.vertexAttribPointer(loc.pos, 3, gl.UNSIGNED_SHORT, false, PAS, 0);
    gl.enableVertexAttribArray(loc.uv);
    gl.vertexAttribPointer(loc.uv, 2, gl.UNSIGNED_SHORT, true, PAS, 6);
    gl.enableVertexAttribArray(loc.couche);
    gl.vertexAttribPointer(loc.couche, 1, gl.UNSIGNED_SHORT, false, PAS, 10);
    gl.enableVertexAttribArray(loc.couleur);
    gl.vertexAttribPointer(loc.couleur, 4, gl.UNSIGNED_BYTE, true, PAS, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, e.indices, e.centres ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    /*
     * Un tampon voilé garde le centre de ses faces : c'est ce qui permettra de
     * les réordonner du plus loin au plus près quand la caméra bouge. Les
     * indices, eux, se refabriquent — inutile d'en garder une copie par étage.
     */
    return {
      y: e.y, vao, vbo, ibo, n: e.faces * 6, faces: e.faces, centres: e.centres || null, trie: false,
    };
  }

  /**
   * Réordonne un tampon voilé, du plus loin au plus près.
   *
   * Le mélange par alpha n'est juste que dans cet ordre : chaque nouvelle
   * couche recouvre une fraction de ce qui est déjà là, si bien que la
   * dernière dessinée l'emporte. Dessinée à l'envers, une façade de verre
   * laisse voir l'intérieur qu'elle devrait masquer — c'est ce que montrait la
   * ferme à shulkers, dont la vitre est un quart de million de blocs.
   *
   * Le tri se fait dans l'échelle entière des positions, celle des centres
   * gardés au maillage : on y amène l'œil plutôt que d'en ramener un million
   * de centres.
   */
  _trier(t, oeil) {
    if (!t || !t.centres || !t.faces) return;
    const gl = this.gl;
    const n = t.faces;
    if (!this._ordre || this._ordre.length < n) {
      this._ordre = new Uint32Array(n);
      this._clefs = new Float64Array(n);
      this._indices = new Uint32Array(n * 6);
    }
    const c = t.centres;
    const clefs = this._clefs;
    const inv = 1 / this.echelle;
    const ex = (oeil[0] + this.marge) * inv;
    const ey = (oeil[1] + this.marge) * inv;
    const ez = (oeil[2] + this.marge) * inv;
    for (let k = 0; k < n; k++) {
      const dx = c[k * 3] - ex;
      const dy = c[(k * 3) + 1] - ey;
      const dz = c[(k * 3) + 2] - ez;
      clefs[k] = (dx * dx) + (dy * dy) + (dz * dz);
    }
    /*
     * Un tableau ordinaire pour le tri : `sort` sur un tableau typé impose la
     * comparaison numérique, qui ne sait pas suivre une clef externe.
     */
    const ordre = Array.from({ length: n }, (_, k) => k);
    ordre.sort((a, b) => clefs[b] - clefs[a]);          // le plus loin d'abord
    const idx = this._indices;
    for (let k = 0; k < n; k++) {
      const v = ordre[k] * 4;
      const o = k * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    gl.bindVertexArray(t.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, t.ibo);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, idx, 0, n * 6);
    gl.bindVertexArray(null);
    t.trie = true;
  }

  /**
   * Remet à trier ce qui doit l'être, et en fait un peu à chaque image.
   *
   * Trier plus d'un million et demi de faces d'un coup prendrait une demi-
   * seconde, et la caméra se figerait à chaque mouvement. On étale donc, comme
   * le jeu : quelques millisecondes par image, les étages les plus proches en
   * premier, et rien tant que l'œil n'a pas bougé d'un bloc.
   */
  _ordonnerVoiles(oeil) {
    const bouge = !this._oeilTri
      || Math.hypot(oeil[0] - this._oeilTri[0], oeil[1] - this._oeilTri[1], oeil[2] - this._oeilTri[2]) > 1;
    if (bouge) {
      this._oeilTri = [...oeil];
      for (const e of this.etages) {
        if (!e) continue;
        for (const nom of TAMPONS) if (e[nom] && e[nom].centres) e[nom].trie = false;
      }
    }
    const BUDGET = 8;                                   // millisecondes par image
    const t0 = performance.now();
    /* Du plus proche au plus loin : ce qu'on regarde se corrige en premier. */
    const dus = [];
    for (let y = this.coupe.min; y <= this.coupe.max; y++) {
      const e = this.etages[y];
      if (!e) continue;
      for (const nom of TAMPONS) {
        const t = e[nom];
        if (t && t.centres && !t.trie && t.faces) dus.push(t);
      }
    }
    if (!dus.length) return;
    dus.sort((a, b) => Math.abs(a.y - oeil[1]) - Math.abs(b.y - oeil[1]));
    for (const t of dus) {
      this._trier(t, oeil);
      if (performance.now() - t0 > BUDGET) break;
    }
    this.demander();
  }

  _viderEtages() {
    const gl = this.gl;
    /* Un plan qu'on remplace n'a plus de bloc visé, ni de masque. */
    this.vise = null;
    if (this.contour) this.contour.clef = '';
    if (this.masques) this.masques.fill(0);
    this.salis.clear();
    for (const e of this.etages) {
      if (!e) continue;
      for (const t of TAMPONS.map((nom) => e[nom])) {
        if (!t) continue;
        gl.deleteBuffer(t.vbo);
        gl.deleteBuffer(t.ibo);
        gl.deleteVertexArray(t.vao);
      }
    }
    this.etages = [];
  }

  _atlas(url, cases, cote) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try { this._televerserTexture(img, cases, cote); resolve(); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('atlas illisible'));
      img.src = url;
    });
  }

  _televerserTexture(img, cases, coteAnnonce) {
    const gl = this.gl;
    this.cases = cases;
    /*
     * Le côté d'une tuile se déduit de l'image, il ne se déclare pas.
     *
     * Le laisser passer par la charge invitait à l'oublier : un appelant qui
     * ne le transmettait pas retombait sur seize, l'atlas en comptait
     * trente-deux, et chaque bloc affichait le quart haut-gauche de sa texture
     * — silencieusement. L'image, elle, sait toujours.
     */
    const cote = Math.round(img.width / cases) || coteAnnonce || 16;

    // Un objet neuf à chaque fois : son type se décide ici, et nulle part
    // ailleurs. Recharger une autre schematic ne peut donc pas hériter du
    // type de la précédente.
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();

    if (!this.tableau) {
      this.cibleTex = gl.TEXTURE_2D;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return;
    }

    /*
     * On redécoupe l'atlas en tuiles. Le processus principal pourrait le livrer
     * déjà en bande, mais il le range en carré depuis longtemps et son cache
     * est sur le disque des utilisateurs : mieux vaut le relire ici, une fois,
     * que réécrire tout ce qui est déjà là.
     */
    const n = cases * cases;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, img.width, img.height).data;

    const plat = new Uint8Array(n * cote * cote * 4);
    for (let i = 0; i < n; i++) {
      const ox = (i % cases) * cote;
      const oy = Math.floor(i / cases) * cote;
      for (let y = 0; y < cote; y++) {
        const de = ((oy + y) * img.width + ox) * 4;
        plat.set(src.subarray(de, de + cote * 4), (i * cote * cote + y * cote) * 4);
      }
    }

    this.cibleTex = gl.TEXTURE_2D_ARRAY;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texture);
    while (gl.getError() !== gl.NO_ERROR) { /* on part d'une ardoise propre */ }
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, cote, cote, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, plat);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);

    /*
     * Un envoi refusé ne se voit pas : la carte garde une texture incomplète,
     * qu'elle échantillonne en noir opaque. Sans ce contrôle, la structure
     * entière devenait noire sans le moindre message. On regarde donc, et on
     * se rabat sur l'atlas plat — moins net au loin, mais juste.
     */
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.warn(`tableau de tuiles refusé (${err}) — retour à l atlas plat`);
      this.tableau = false;
      this._construireProgramme();
      this._televerserTexture(img, cases, cote);
      return;
    }
    /*
     * Agrandissement au plus proche : de près, on veut les pixels francs du
     * jeu. Réduction par niveaux : de loin, une ferme entière fourmillerait
     * sans eux — chaque lattis d'échafaudage tombant sous le pixel.
     */
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* ------------------------------------------------------------- dessin */

  /**
   * Change la disposition de clavier, et rend les positions retenues.
   *
   * Les touches enfoncées sont oubliées au passage : une position relâchée
   * après le changement ne correspondrait plus à rien, et l'on partirait tout
   * seul en avant.
   */
  async disposition(dispo) {
    this.codes = await codesDe(dispo);
    this.vol.touches.clear();
    return this.codes;
  }

  /**
   * Le bloc que la caméra vise, ou `null` si le rayon ne rencontre rien.
   *
   * Parcours d'Amanatides et Woo : on avance d'un emplacement à l'autre le
   * long du rayon, en prenant à chaque pas l'axe dont la prochaine frontière
   * est la plus proche. Aucun échantillonnage, aucun pas raté — et le coût ne
   * dépend que de la portée, jamais de la taille de la structure.
   *
   * La tranche est respectée : on ne vise pas un étage que la coupe a retiré,
   * puisqu'on ne le voit pas.
   *
   * @param {number} portee en blocs
   * @returns {{x:number,y:number,z:number,etat:number,face:string}|null}
   */
  viser(portee = 160) {
    if (!this.grille || !this.taille) return null;
    const t = this.taille;
    const oeil = this._oeil();
    const cam = this.camera;
    const cp = Math.cos(cam.tangage);
    const d = [-Math.sin(cam.lacet) * cp, -Math.sin(cam.tangage), -Math.cos(cam.lacet) * cp];

    let x = Math.floor(oeil[0]);
    let y = Math.floor(oeil[1]);
    let z = Math.floor(oeil[2]);
    const pas = [d[0] > 0 ? 1 : -1, d[1] > 0 ? 1 : -1, d[2] > 0 ? 1 : -1];
    /* Distance à parcourir pour franchir une frontière, par axe. */
    const dt = [Math.abs(1 / d[0]), Math.abs(1 / d[1]), Math.abs(1 / d[2])];
    const prochain = [
      d[0] > 0 ? (x + 1 - oeil[0]) * dt[0] : (oeil[0] - x) * dt[0],
      d[1] > 0 ? (y + 1 - oeil[1]) * dt[1] : (oeil[1] - y) * dt[1],
      d[2] > 0 ? (z + 1 - oeil[2]) * dt[2] : (oeil[2] - z) * dt[2],
    ];
    const FACES = [['east', 'west'], ['up', 'down'], ['south', 'north']];
    let face = null;
    let parcouru = 0;
    for (let n = 0; n < portee * 3 && parcouru <= portee; n++) {
      if (x >= 0 && y >= 0 && z >= 0 && x < t.x && y < t.y && z < t.z
        && y >= this.coupe.min && y <= this.coupe.max) {
        const etat = this.grille[(((y * t.z) + z) * t.x) + x];
        if (etat) return { x, y, z, etat, face };
      }
      /* L'axe dont la frontière vient en premier. */
      const a = prochain[0] < prochain[1]
        ? (prochain[0] < prochain[2] ? 0 : 2)
        : (prochain[1] < prochain[2] ? 1 : 2);
      parcouru = prochain[a];
      prochain[a] += dt[a];
      if (a === 0) x += pas[0]; else if (a === 1) y += pas[1]; else z += pas[2];
      /* On entre par la face opposée au sens du pas. */
      face = FACES[a][pas[a] > 0 ? 1 : 0];
      /* Sorti du volume et s'en éloignant : inutile d'insister. */
      if ((x < 0 && pas[0] < 0) || (x >= t.x && pas[0] > 0)
        || (y < 0 && pas[1] < 0) || (y >= t.y && pas[1] > 0)
        || (z < 0 && pas[2] < 0) || (z >= t.z && pas[2] > 0)) return null;
    }
    return null;
  }

  /**
   * Combien de tampons voilés attendent encore leur tri.
   *
   * Le tri s'étale sur plusieurs images pour ne pas figer la caméra ; qui veut
   * une image définitive — une capture, un banc d'essai — dessine tant que ce
   * compte n'est pas nul.
   */
  voilesEnAttente() {
    let n = 0;
    for (let y = this.coupe.min; y <= this.coupe.max; y++) {
      const e = this.etages[y];
      if (!e) continue;
      for (const nom of TAMPONS) {
        const t = e[nom];
        if (t && t.centres && !t.trie && t.faces) n++;
      }
    }
    return n;
  }

  /** Demande une image ; plusieurs appels dans la même trame n'en font qu'une. */
  demander() {
    if (this.aDessiner) return;
    this.aDessiner = true;
    requestAnimationFrame(() => { this.aDessiner = false; this.dessiner(); });
  }
  /** Où se tient l'œil, déduit de la cible et des angles. */
  _oeil() {
    const c = this.camera;
    const cp = Math.cos(c.tangage);
    return [
      c.cible[0] + Math.sin(c.lacet) * cp * c.distance,
      c.cible[1] + Math.sin(c.tangage) * c.distance,
      c.cible[2] + Math.cos(c.lacet) * cp * c.distance,
    ];
  }

  /**
   * Tourne le regard **autour de l'œil**, comme on tourne la tête.
   *
   * La caméra est une orbite : elle tient par une cible et une distance, et
   * changer les angles fait glisser l'œil sur une sphère autour de cette
   * cible. C'est ce qu'on veut pour examiner un plan de l'extérieur. En vol,
   * c'est absurde : `cadrer` place la cible à près de trois cents blocs devant
   * sur une grande structure, et le moindre geste de souris emportait l'œil
   * dans un arc de plusieurs blocs au lieu de le faire pivoter sur place.
   *
   * On garde donc l'œil où il est, et c'est la cible qu'on déplace derrière
   * les angles. Rien ne change dans le rendu ; seule la manière de tenir la
   * caméra devient celle du jeu.
   */
  _tourner(dLacet, dTangage) {
    const c = this.camera;
    const o = this._oeil();
    c.lacet += dLacet;
    c.tangage = Math.max(-PENTE_MAX, Math.min(PENTE_MAX, c.tangage + dTangage));
    const cp = Math.cos(c.tangage);
    c.cible[0] = o[0] - Math.sin(c.lacet) * cp * c.distance;
    c.cible[1] = o[1] - Math.sin(c.tangage) * c.distance;
    c.cible[2] = o[2] - Math.cos(c.lacet) * cp * c.distance;
  }


  dessiner() {
    const gl = this.gl;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const l = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== l || c.height !== h) { c.width = l; c.height = h; }
    gl.viewport(0, 0, l, h);
    gl.clearColor(this.fond[0], this.fond[1], this.fond[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    /*
     * Tant que l'atlas n'est pas arrivé, on s'arrête au fond peint. Toucher à
     * la texture ici la figerait dans le mauvais type, et l'atlas ne pourrait
     * plus s'y installer — c'est ce qui rendait toute la structure noire.
     */
    if (!this.texture) return;

    const cam = this.camera;
    const oeil = this._oeil();
    const mvp = multiplier(
      perspective(cam.fov || Math.PI / 4, l / h, 0.1, cam.distance * 4 + 600),
      regarder(oeil, cam.cible, [0, 1, 0]),
    );

    /*
     * Ce que le réticule désigne, une fois par image et seulement en vol.
     *
     * En orbite, le centre de l'écran n'est pas ce qu'on pointe — c'est la
     * souris. Un réticule y désignerait au hasard.
     */
    /*
     * On vise à chaque image, que quelqu'un écoute ou non : le contour en a
     * besoin autant que l'affichage des infos.
     */
    const v = this.vol.actif ? this.viser() : null;
    this.vise = v;
    if (this.surVisee) {
      const clef = v ? `${v.x},${v.y},${v.z}` : '';
      if (clef !== this._visee) { this._visee = clef; this.surVisee(v); }
    }

    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(this.cibleTex, this.texture);
    gl.uniform1i(this.loc.atlas, 0);
    if (this.loc.cases) gl.uniform1f(this.loc.cases, this.cases);
    gl.uniformMatrix4fv(this.loc.mvp, false, mvp);
    gl.uniform1f(this.loc.echelle, this.echelle);
    gl.uniform1f(this.loc.marge, this.marge);
    gl.uniform3fv(this.loc.fond, this.fond);
    gl.uniform1f(this.loc.brume, 0.9 / (cam.distance * 6 + 80));

    // Un étage souligné n'a de sens que si l'on a effectivement coupé.
    const coupee = this.coupe.max < this.hauteur - 1;
    let dessines = 0;
    const tracer = (t, y) => {
      if (!t) return;
      gl.uniform1f(this.loc.sommet, coupee && y === this.coupe.max ? 1 : 0);
      gl.bindVertexArray(t.vao);
      gl.drawElements(gl.TRIANGLES, t.n, gl.UNSIGNED_INT, 0);
      dessines += t.n / 6;
    };

    /* D'abord tout ce qui est plein : c'est lui qui remplit la profondeur. */
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.uniform1f(this.loc.voile, 0);
    for (let y = this.coupe.min; y <= this.coupe.max; y++) {
      if (this.etages[y]) tracer(this.etages[y].opaque, y);
    }
    /*
     * Ce que la coupe découvre.
     *
     * Une face collée à sa voisine du dessus ou du dessous n'est pas dessinée
     * — sauf quand la coupe retire justement cette voisine. Seuls les deux
     * étages du bord de la tranche sont dans ce cas ; ailleurs le voisinage
     * est intact. Sans coupe, ces tampons sont vides : au ras du sol comme au
     * sommet, il n'y avait aucun voisin pour cacher quoi que ce soit.
     */
    if (this.etages[this.coupe.min]) tracer(this.etages[this.coupe.min].basOpaque, this.coupe.min);
    if (this.etages[this.coupe.max]) tracer(this.etages[this.coupe.max].hautOpaque, this.coupe.max);

    /*
     * Le contour du bloc visé, entre les deux passes.
     *
     * Après l'opaque, pour que la structure le cache quand il est derrière
     * elle ; avant les vitres, pour qu'on le voie **au travers** d'une paroi
     * de verre — dans une ferme vitrée, c'est le seul moment où il se voit.
     */
    if (v) {
      if (!this.contour) this._construireContour();
      const co = this.contour;
      const clef = `${v.x},${v.y},${v.z}`;
      if (co.clef !== clef) { co.clef = clef; this._poserContour(v); }
      gl.useProgram(co.prog);
      gl.uniformMatrix4fv(co.mvp, false, mvp);
      gl.uniform4f(co.couleur, 0, 0, 0, 0.55);
      gl.bindVertexArray(co.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.LINES, 0, 24);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      gl.useProgram(this.prog);
    }

    /*
     * Puis les vitres, mélangées à ce qui est déjà là.
     *
     * Sans écrire dans le tampon de profondeur : deux vitres l'une derrière
     * l'autre doivent toutes deux se voir. Et du plus loin au plus près —
     * l'ordre compte dès qu'on superpose des transparences.
     */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    /* Du plus loin au plus près : l'ordre fait toute la justesse du mélange. */
    this._ordonnerVoiles(oeil);
    /*
     * Aucun décalage de profondeur ici, et c'est délibéré.
     *
     * Cette passe portait un `polygonOffset(1, 1)`, mis pour séparer les faces
     * d'un fluide de celles du bloc qu'il baigne. Il repoussait en réalité
     * **toute** la passe vers le fond, d'une quantité qui croît comme le carré
     * de la distance — et une poussière de redstone ne se tient qu'à 0,0156
     * bloc au-dessus de son sol. Passé une vingtaine de blocs, le décalage
     * dépassait ce dégagement : le fil passait derrière le sol et s'effaçait
     * par plaques à mesure que la caméra reculait. Mesuré : à vingt-six blocs,
     * neuf mille quatre cents pixels rouges avec, treize mille huit cents sans.
     *
     * La coïncidence de plans se règle là où elle naît : le maillage recule
     * les faces de fluide du millième de bloc du jeu, porté au besoin à deux
     * crans de quantification pour qu'il survive à l'arrondi.
     */
    gl.uniform1f(this.loc.voile, 1);
    /*
     * Les étages, du plus éloigné de l'œil au plus proche.
     *
     * Un simple balayage — de haut en bas ou l'inverse — ne convient qu'à la
     * moitié d'entre eux. La caméra est quelque part au milieu de la
     * structure : au-dessus d'elle, descendre va bien du loin vers le près ;
     * en dessous, c'est exactement l'inverse. D'où une façade correcte au-
     * dessus du regard et brouillée en dessous, la limite suivant la hauteur
     * de la caméra — c'est ce que montrait la ferme à shulkers.
     *
     * Le bon ordre part donc des deux extrémités et converge vers l'étage où
     * se tient l'œil. Trier deux cent soixante nombres à chaque image ne coûte
     * rien.
     */
    const bornes = `${this.coupe.min}:${this.coupe.max}`;
    if (this._bornesEtages !== bornes) {
      this._bornesEtages = bornes;
      this._ordreEtages = [];
      for (let y = this.coupe.min; y <= this.coupe.max; y++) this._ordreEtages.push(y);
    }
    const oeilY = oeil[1];
    this._ordreEtages.sort((a, b) => Math.abs(b + 0.5 - oeilY) - Math.abs(a + 0.5 - oeilY));
    for (const y of this._ordreEtages) {
      if (this.etages[y]) tracer(this.etages[y].translucide, y);
    }
    if (this.etages[this.coupe.min]) tracer(this.etages[this.coupe.min].basTranslucide, this.coupe.min);
    if (this.etages[this.coupe.max]) tracer(this.etages[this.coupe.max].hautTranslucide, this.coupe.max);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(null);
    this.dernieres = dessines;
    if (this.surImage) this.surImage(dessines);
  }

  /* ------------------------------------------------------------ réglages */

  /** Ne montre que les étages `min` à `max`, bornes comprises. */
  tranche(min, max) {
    this.coupe.min = Math.max(0, Math.min(min, this.hauteur - 1));
    this.coupe.max = Math.max(this.coupe.min, Math.min(max, this.hauteur - 1));
    this.demander();
  }

  /**
   * Repose la caméra sur la structure entière.
   *
   * La distance se calcule sur la sphère qui contient tout : c'est la seule
   * mesure qui tienne quel que soit l'angle, alors qu'un multiple du plus
   * grand côté laisse une plaque de 288 × 23 minuscule et fait déborder un
   * cube. La toile étant plus large que haute, c'est la hauteur qui décide.
   */
  cadrer(lacet = -0.7, tangage = 0.5) {
    this.camera.lacet = lacet;
    this.camera.tangage = tangage;
    const t = this.taille;
    if (t) {
      this.camera.cible = [t.x / 2, t.y / 2, t.z / 2];
      const rayon = 0.5 * Math.hypot(t.x, t.y, t.z);
      const c = this.canvas;
      const ratio = (c.clientWidth || 16) / (c.clientHeight || 9);
      const demiFov = Math.atan(Math.tan((this.camera.fov || Math.PI / 4) / 2) * Math.min(1, ratio));
      // Un peu de marge : les échafaudages et les barrières débordent de leur
      // emplacement, et un plan coupé au ras des pieds se lit mal.
      this.camera.distance = Math.max(2, (rayon / Math.tan(demiFov)) * 1.15);
    }
    this.demander();
  }

  /**
   * Entre ou sort du vol libre.
   *
   * La souris est capturée : on regarde autour de soi sans tenir de bouton,
   * comme en jeu. Échap la rend, et le vol s'arrête avec elle — c'est le geste
   * qu'on a déjà dans les doigts, autant ne pas en inventer un autre.
   */
  voler(oui) {
    const c = this.canvas;
    const veut = !!oui;
    if (veut === this.vol.actif) return this.vol.actif;
    this.vol.actif = veut;
    this.vol.touches.clear();
    if (veut) {
      /*
       * Le champ de vision du jeu : soixante-dix degrés à la verticale.
       *
       * Le rendu s'ouvre à quarante-cinq, plus sage pour examiner un plan de
       * loin — moins de déformation sur les bords. Mais dès qu'on entre dedans,
       * quarante-cinq degrés donnent l'impression de regarder par un tube : on
       * perd le pas de côté et le sol sous ses pieds. On rend son champ à la
       * caméra en sortant.
       */
      this.vol.fovAvant = this.camera.fov;
      this.camera.fov = FOV_VOL / this.vol.loupe;
      /*
       * On rend le focus à la page.
       *
       * S'il restait sur le curseur de vitesse ou celui des couches, les
       * flèches continueraient de le déplacer pendant qu'on vole, et la barre
       * d'espace risquerait de l'actionner. Le vol veut le clavier pour lui.
       */
      try { if (document.activeElement && document.activeElement !== c) document.activeElement.blur(); } catch { /* rien à rendre */ }
      try { c.requestPointerLock(); } catch { /* refusée : on volera souris libre */ }
      this.vol.dernier = performance.now();
      const pas = () => {
        if (!this.vol.actif) { this.vol.boucle = 0; return; }
        this._avancer();
        this.vol.boucle = requestAnimationFrame(pas);
      };
      this.vol.boucle = requestAnimationFrame(pas);
    } else {
      if (this.vol.fovAvant) this.camera.fov = this.vol.fovAvant;
      if (this.vol.boucle) cancelAnimationFrame(this.vol.boucle);
      this.vol.boucle = 0;
      if (document.pointerLockElement === c) document.exitPointerLock();
    }
    this.demander();
    if (this.surVol) this.surVol(this.vol.actif);
    return this.vol.actif;
  }

  /**
   * Un pas de vol : ce que les touches enfoncées font pendant ce laps de temps.
   *
   * Le déplacement se compte en blocs par seconde, pas par image : sur une
   * grande structure la cadence tombe, et une vitesse comptée par image ferait
   * ralentir le vol au moment précis où l'on a le plus besoin d'en sortir.
   */
  _avancer() {
    const t = performance.now();
    const dt = Math.min(0.1, (t - this.vol.dernier) / 1000);
    this.vol.dernier = t;
    const k = this.vol.touches;
    const c = this.codes;
    const avance = (k.has(c.avant) ? 1 : 0) - (k.has(c.arriere) ? 1 : 0);
    const cote = (k.has(c.droite) ? 1 : 0) - (k.has(c.gauche) ? 1 : 0);
    const monte = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('ControlRight') ? 1 : 0);
    if (!avance && !cote && !monte) return;
    const cam = this.camera;
    const cp = Math.cos(cam.tangage);
    /* Le regard, pente comprise : viser le sol et avancer fait descendre. */
    const av = [-Math.sin(cam.lacet) * cp, -Math.sin(cam.tangage), -Math.cos(cam.lacet) * cp];
    /* Le pas de côté reste à l'horizontale, sinon on roule sur l'aile. */
    const co = [Math.cos(cam.lacet), 0, -Math.sin(cam.lacet)];
    /* Une diagonale ne doit pas aller plus vite qu'une ligne droite. */
    const n = Math.hypot(avance, cote, monte) || 1;
    const d = (this.vol.vitesse * dt) / n;
    cam.cible[0] += (av[0] * avance + co[0] * cote) * d;
    cam.cible[1] += (av[1] * avance + monte) * d;
    cam.cible[2] += (av[2] * avance + co[2] * cote) * d;
    this.demander();
  }

  couleurFond(rgb) {
    this.fond = rgb;
    this.demander();
  }

  detruire() {
    const gl = this.gl;
    this.voler(false);
    if (this._ecoutes) {
      window.removeEventListener('keydown', this._ecoutes.bas);
      window.removeEventListener('keyup', this._ecoutes.haut);
      window.removeEventListener('blur', this._ecoutes.oubli);
      document.removeEventListener('pointerlockchange', this._ecoutes.verrou);
      this._ecoutes = null;
    }
    this._viderEtages();
    if (this.texture) gl.deleteTexture(this.texture);
    gl.deleteProgram(this.prog);
    const p = gl.getExtension('WEBGL_lose_context');
    if (p) p.loseContext();
  }
}
