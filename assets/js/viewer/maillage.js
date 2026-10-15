/**
 * Construction du maillage d'une schematic.
 *
 * On part des boîtes que le processus principal a tirées des modèles du jeu,
 * et on en fait des triangles. Quatre décisions font tenir une ferme de cent
 * cinquante mille blocs :
 *
 *  · **un tampon par étage.** La découpe par couches est le geste courant
 *    quand on bâtit d'après un plan ; découper le maillage de la même façon
 *    rend la coupe exacte par construction, et surtout permet de ne pas
 *    envoyer à la carte les étages qu'on ne regarde pas. Vingt-trois appels de
 *    dessin ne coûtent rien ; vingt-trois fois moins de géométrie, si.
 *
 *  · **les faces cachées ne sont pas émises** : une face marquée `cullface`
 *    dont le voisin de ce côté est un bloc plein ne se verra jamais.
 *
 *  · **des sommets de seize octets.** Position en entiers courts sur une
 *    échelle propre à la structure, coordonnées de texture en entiers courts
 *    normalisés, couleur en quatre octets. En flottants partout, la même ferme
 *    demandait trois cents mégaoctets.
 *
 *  · **deux passes** — on compte les faces de chaque étage, puis on remplit
 *    des tampons de la bonne taille. Empiler dans des tableaux JS coûterait
 *    ici plusieurs centaines de mégaoctets et le temps de les recopier.
 */

/**
 * Coins d'une face, dans l'ordre des coins de texture
 * (u0,v0) (u1,v0) (u1,v1) (u0,v1) — le premier est en haut à gauche, vu du
 * dehors. Les positions sont en seizièmes de bloc, comme dans les modèles.
 */
const COINS = {
  up: (a, b) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]],
  down: (a, b) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]],
  north: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]],
  south: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]],
  west: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], b[2]], [a[0], a[1], a[2]]],
  east: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]],
};

/**
 * Coordonnées de texture par défaut, quand le modèle n'en donne pas.
 * Ce sont celles de Minecraft : la face prend la portion de texture qui
 * correspond à son emprise sur le bloc, sans quoi une dalle afficherait une
 * texture entière écrasée sur une demi-hauteur.
 */
function uvParDefaut(dir, a, b) {
  const [x0, y0, z0] = a;
  const [x1, y1, z1] = b;
  switch (dir) {
    case 'up': return [x0, z0, x1, z1];
    case 'down': return [x0, 16 - z1, x1, 16 - z0];
    case 'north': return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case 'south': return [x0, 16 - y1, x1, 16 - y0];
    case 'west': return [z0, 16 - y1, z1, 16 - y0];
    default: return [16 - z1, 16 - y1, 16 - z0, 16 - y0];   // east
  }
}

/** Éclairage par face, comme dans le jeu : le dessus en pleine lumière. */
const OMBRE = { up: 1, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };

const DELTA = {
  up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1],
  south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};

/**
 * Les dessins d'un fluide, au repos et en pente.
 *
 * Ils sont recopiés de `blockmodels.js` plutôt que partagés : celui-ci vit
 * côté Electron, le maillage côté page, et rien ne circule entre les deux hors
 * du modèle chargé. Un essai confronte les deux tables pour qu'elles ne
 * dérivent pas en silence.
 */
const FLUIDES = {
  water: { repos: 'block/water_still', pente: 'block/water_flow' },
  lava: { repos: 'block/lava_still', pente: 'block/lava_flow' },
};

/** La teinte de l'eau, celle que porte la majorité des biomes de la 26.2. */
const TEINTE_EAU = [0x3f, 0x76, 0xe4];

/** Boîte de secours pour les blocs que le jeu dessine comme des entités. */
const SANS_MODELE = [{
  from: [3, 0, 3], to: [13, 12, 13], ombre: true, pivot: null,
  faces: Object.fromEntries(Object.keys(OMBRE).map((d) => [d, { tex: null, coins: null, cull: null }])),
}];

/**
 * Octets par sommet : 3 entiers courts de position, 2 d'uv **dans la tuile**,
 * 1 de numéro de tuile, 4 octets de couleur.
 *
 * Les coordonnées de texture restent locales à la tuile plutôt que de désigner
 * un point de l'atlas. C'est ce qui permet au rendu de choisir sa manière de
 * ranger les textures — un tableau de tuiles quand la carte le sait faire, un
 * atlas plat sinon — sans que le maillage ait à le savoir.
 */
export const PAS = 16;

/** Une coordonnée de texture en seizièmes, ramenée dans l'entier court. */
const borne = (v) => Math.max(0, Math.min(65535, Math.round((v / 16) * 65535)));

function pivoter(p, pivot) {
  if (!pivot || !pivot.angle) return p;
  const a = (pivot.angle * Math.PI) / 180;
  const [ox, oy, oz] = pivot.origine;
  let x = p[0] - ox;
  let y = p[1] - oy;
  let z = p[2] - oz;
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (pivot.axe === 'x') { const ny = y * c - z * s; z = y * s + z * c; y = ny; }
  else if (pivot.axe === 'y') { const nx = x * c + z * s; z = -x * s + z * c; x = nx; }
  else { const nx = x * c - y * s; y = x * s + y * c; x = nx; }
  if (pivot.rescale) {
    const k = 1 / Math.cos(a);
    if (pivot.axe === 'x') { y *= k; z *= k; }
    else if (pivot.axe === 'y') { x *= k; z *= k; }
    else { x *= k; y *= k; }
  }
  return [x + ox, y + oy, z + oz];
}

/**
 * Applique la rotation d'une boîte, ou la suite de ses rotations.
 *
 * Une oreille de piglin tourne d'un trentième de tour dans le repère de sa
 * tête ; si la tête elle-même est posée à 22,5°, les deux se composent. Une
 * boîte porte donc soit un pivot, soit une liste, appliquée dans l'ordre.
 */
function pivoterTout(p, pivot) {
  if (!pivot) return p;
  if (!Array.isArray(pivot)) return pivoter(p, pivot);
  let q = p;
  for (const x of pivot) q = pivoter(q, x);
  return q;
}

/**
 * Assemble le maillage, un tampon par étage.
 *
 * @param {object} m modèle renvoyé par `sch:model3d`
 * @param {{masques?:Uint8Array, etages?:Set<number>}} [opts]
 *   `masques` : un octet par emplacement, 1 pour un bloc qu'on veut faire
 *   disparaître. Il est traité comme du vide **partout** — il n'émet plus ses
 *   faces, et il cesse de cacher celles de ses voisins, sans quoi le masquer
 *   ouvrirait un trou par lequel on verrait l'envers de la structure.
 *   `etages` : les seules tranches à bâtir. Les autres reviennent à `null`
 *   et l'appelant garde les siennes. C'est ce qui rend le masquage
 *   interactif : sur la ferme à shulkers, tout rebâtir coûte 1,1 s — mesuré —
 *   contre une centaine de millisecondes pour trois étages.
 * @returns {{etages:Array, echelle:number, faces:number, cullees:number, octets:number}}
 *   `echelle` est le facteur qui ramène les entiers courts en blocs ; le
 *   shader la reçoit en uniforme.
 */
export function construire(m, opts = {}) {
  const masques = opts.masques || null;
  const etagesVoulus = opts.etages || null;
  const { positions, etats, couleurs, n, taille } = m.modele;
  const geo = m.etats;

  /*
   * L'échelle est choisie pour la structure : les positions tiennent dans un
   * entier court sans jamais déborder, et la précision suit la taille. Sur une
   * ferme de 288 blocs cela fait un quatorzième de texel — invisible ; sur une
   * structure démesurée on perd de la finesse plutôt que de la justesse.
   *
   * La marge n'est pas un ornement. Beaucoup de modèles débordent de leur
   * emplacement — une torche murale commence à x = −1, une tête de piston
   * sort d'un demi-bloc. Sans décalage, ces coordonnées négatives repassaient
   * par le haut de l'entier court : le coin partait à l'autre bout de la
   * structure et la torche se dessinait en coin cisaillé. Deux blocs de part
   * et d'autre couvrent tout ce que les modèles du jeu s'autorisent, et le
   * bornage interdit qu'un cas non prévu recommence.
   */
  const MARGE = 2;
  const plage = Math.max(taille.x, taille.y, taille.z, 1) + 1 + 2 * MARGE;
  const echelle = plage / 65535;
  const inv = 1 / echelle;
  const coder = (v) => {
    const n = Math.round((v + MARGE) * inv);
    return n < 0 ? 0 : (n > 65535 ? 65535 : n);
  };

  /*
   * Occupation : pour chaque emplacement, 1 si un bloc plein l'occupe. C'est
   * la seule question que pose le masquage des faces, et un tableau plat y
   * répond sans hachage. Au-delà d'un volume déraisonnable on s'en passe : on
   * dessinera quelques faces de trop plutôt que d'avaler la mémoire.
   */
  const volume = taille.x * taille.y * taille.z;

  /*
   * Un bloc masqué n'existe plus, pour personne.
   *
   * Le prédicat sert aux quatre grilles de voisinage autant qu'à l'émission :
   * si l'on se contentait de ne plus dessiner ses faces, ses voisins
   * continueraient de cacher les leurs contre lui et le trou laisserait voir
   * l'envers de la structure au lieu de son intérieur.
   */
  const masque = (i) => {
    if (!masques) return false;
    const y = positions[i * 3 + 1];
    if (!Number.isInteger(y)) return false;
    return masques[((y * taille.z) + positions[i * 3 + 2]) * taille.x + positions[i * 3]] === 1;
  };

  /* Une entité tombe entre deux étages : elle compte pour celui qui la porte. */
  const etageDe = (by) => Math.max(0, Math.min(taille.y - 1, Math.floor(by)));

  // Opaque, pas seulement plein : on ne masque rien derrière une vitre.
  const pleins = geo.map((e) => (e.opaque !== undefined ? !!e.opaque : !!e.cube));
  // Plein au sens de la forme : c'est la condition pour recevoir l'ombre des
  // angles, qu'une vitre mérite autant qu'un mur de pierre.
  const cubes = geo.map((e) => !!e.cube);
  let occupe = null;
  if (volume > 0 && volume < 96 * 1024 * 1024) {
    occupe = new Uint8Array(volume);
    for (let i = 0; i < n; i++) {
      if (masque(i)) continue;
      if (!pleins[etats[i] - 1]) continue;
      occupe[(positions[i * 3 + 1] * taille.z + positions[i * 3 + 2]) * taille.x + positions[i * 3]] = 1;
    }
  }
  const bouche = (x, y, z) => {
    if (!occupe) return false;
    if (x < 0 || y < 0 || z < 0 || x >= taille.x || y >= taille.y || z >= taille.z) return false;
    return occupe[(y * taille.z + z) * taille.x + x] === 1;
  };

  /*
   * Les blocs qui effacent la paroi qu'ils partagent avec leur pareil.
   *
   * Le jeu appelle cela `skipRendering`, et le réserve aux blocs à demi
   * transparents : le verre sous toutes ses formes, la glace, le miel, la glu.
   * Deux vitres côte à côte ne dessinent pas la cloison qui les sépare — sans
   * quoi on la voit par transparence, doublée et plus sombre, et un mur de
   * verre se couvre d'une grille de traits foncés le long de chaque joint.
   *
   * Le voisinage se lit dans un second tableau, jumeau de l'occupation : un
   * numéro de famille par emplacement, zéro pour tout le reste. Un octet suffit
   * — le jeu ne compte qu'une vingtaine de blocs de ce genre.
   */
  const MEME = /^(glass|tinted_glass|ice|frosted_ice|honey_block|slime_block)$|_stained_glass$/;
  const numeros = new Map();
  const familles = geo.map((e) => {
    if (!MEME.test(e.nom)) return 0;
    if (!numeros.has(e.nom)) numeros.set(e.nom, numeros.size + 1);
    return numeros.get(e.nom);
  });
  let pareils = null;
  if (occupe && numeros.size) {
    pareils = new Uint8Array(volume);
    for (let i = 0; i < n; i++) {
      if (masque(i)) continue;
      const f = familles[etats[i] - 1];
      if (!f) continue;
      pareils[(positions[i * 3 + 1] * taille.z + positions[i * 3 + 2]) * taille.x + positions[i * 3]] = f;
    }
  }
  const memeQue = (x, y, z, f) => {
    if (!pareils || !f) return false;
    if (x < 0 || y < 0 || z < 0 || x >= taille.x || y >= taille.y || z >= taille.z) return false;
    return pareils[(y * taille.z + z) * taille.x + x] === f;
  };

  /* ------------------------------------------------------------- fluides */

  /*
   * L'eau et la lave, telles que le jeu les dessine.
   *
   * Un fluide n'a pas de modèle : `FluidRenderer` le construit à la volée, et
   * sa surface **penche**. Chacun des quatre coins du dessus prend une hauteur
   * moyenne, calculée sur le bloc lui-même, ses deux voisins de ce côté et le
   * voisin en diagonale. Une nappe qui s'écoule descend donc en rampes
   * continues au lieu de former des marches, et c'est ce qu'on voit dans le
   * jeu : une mare de lave a un dôme au-dessus de sa source et des pentes
   * douces jusqu'à ses bords.
   *
   * Cela ne se décide pas dans le modèle, qui ne connaît qu'un bloc à la fois.
   * C'est ici, où la grille est sous la main, que ça se calcule.
   *
   * Les nombres viennent de `FluidRenderer` et de `FlowingFluid` : la moyenne
   * pondérée donne dix fois plus de poids à un voisin déjà haut (≥ 0,8), une
   * quantité vaut son neuvième de bloc, et un retrait sépare les plans qui
   * coïncideraient.
   */
  const SORTES = { water: 16, lava: 32 };
  const HAUT = 0x30;
  const fluides = geo.map((e) => e.fluide || null);
  const aDuFluide = fluides.some(Boolean);
  let nappe = null;
  if (occupe && aDuFluide) {
    nappe = new Uint8Array(volume);
    for (let i = 0; i < n; i++) {
      if (masque(i)) continue;
      const fl = fluides[etats[i] - 1];
      if (!fl) continue;
      nappe[((positions[i * 3 + 1] * taille.z) + positions[i * 3 + 2]) * taille.x + positions[i * 3]] = SORTES[fl.sorte] | fl.quantite;
    }
  }
  /*
   * La forme, distincte de l'opacité.
   *
   * Le jeu demande `isSolid()` — la forme remplit-elle le bloc — là où
   * `occupe` répond « est-ce opaque ». Contre un mur de verre, la nuance
   * décide si la nappe garde sa hauteur ou s'effile jusqu'à zéro.
   */
  let pleinsCubes = null;
  if (occupe && aDuFluide) {
    pleinsCubes = new Uint8Array(volume);
    for (let i = 0; i < n; i++) {
      if (masque(i)) continue;
      if (!cubes[etats[i] - 1]) continue;
      pleinsCubes[((positions[i * 3 + 1] * taille.z) + positions[i * 3 + 2]) * taille.x + positions[i * 3]] = 1;
    }
  }
  const dansLaGrille = (x, y, z) => x >= 0 && y >= 0 && z >= 0
    && x < taille.x && y < taille.y && z < taille.z;
  const laNappe = (x, y, z) => (nappe && dansLaGrille(x, y, z)
    ? nappe[((y * taille.z) + z) * taille.x + x] : 0);
  const laForme = (x, y, z) => (pleinsCubes && dansLaGrille(x, y, z)
    ? pleinsCubes[((y * taille.z) + z) * taille.x + x] === 1 : false);

  /**
   * La hauteur d'un emplacement pour le calcul des coins — `getHeight`.
   *
   * Un bloc du même fluide rend sa propre hauteur, ou un bloc entier si le même
   * fluide le surplombe. Un bloc qui n'est pas ce fluide rend zéro s'il est
   * traversable — la nappe s'y effile — et **moins un** s'il est plein, ce qui
   * l'exclut de la moyenne : l'eau ne s'abaisse pas au pied d'un mur.
   */
  const hauteurNappe = (x, y, z, s) => {
    const v = laNappe(x, y, z);
    if ((v & HAUT) === s) return (laNappe(x, y + 1, z) & HAUT) === s ? 1 : (v & 15) / 9;
    return laForme(x, y, z) ? -1 : 0;
  };

  /** `addWeightedHeight` : un voisin presque plein pèse dix fois plus. */
  const peser = (acc, h) => {
    if (h >= 0.8) { acc[0] += h * 10; acc[1] += 10; } else if (h >= 0) { acc[0] += h; acc[1] += 1; }
  };

  /** `calculateAverageHeight` : la hauteur d'un coin, sur ses quatre blocs. */
  const coinNappe = (hs, h2, h3, x, y, z, s) => {
    if (h2 >= 1 || h3 >= 1) return 1;
    const acc = [0, 0];
    if (h2 > 0 || h3 > 0) {
      const hd = hauteurNappe(x, y, z, s);
      if (hd >= 1) return 1;
      peser(acc, hd);
    }
    peser(acc, hs);
    peser(acc, h2);
    peser(acc, h3);
    return acc[1] ? acc[0] / acc[1] : 0;
  };

  const AUTOUR = [[0, -1], [0, 1], [-1, 0], [1, 0]];   // nord, sud, ouest, est

  /**
   * Le sens de l'écoulement — `FlowingFluid.getFlow`.
   *
   * Chaque voisin tire la nappe vers lui à proportion de la marche qui les
   * sépare ; un voisin vide au-dessus d'un fluide tire aussi, d'où l'eau qui
   * s'oriente vers le trou dans lequel elle tombe. Un fluide en chute, s'il
   * longe une paroi, prend une forte composante verticale : normalisée, elle
   * écrase presque le reste.
   */
  const sensNappe = (x, y, z, s, hs, tombe) => {
    let dx = 0;
    let dz = 0;
    for (const [ux, uz] of AUTOUR) {
      const v = laNappe(x + ux, y, z + uz);
      const meme = (v & HAUT) === s;
      if (!meme && v !== 0) continue;                 // un autre fluide n'agit pas
      let ecart = 0;
      const h = meme ? (v & 15) / 9 : 0;
      if (h > 0) {
        ecart = hs - h;
      } else if (!laForme(x + ux, y, z + uz)) {
        const vb = laNappe(x + ux, y - 1, z + uz);
        if ((vb & HAUT) === s) {
          const hb = (vb & 15) / 9;
          if (hb > 0) ecart = hs - (hb - (8 / 9));
        }
      }
      if (ecart !== 0) { dx += ux * ecart; dz += uz * ecart; }
    }
    let vy = 0;
    if (tombe) {
      for (const [ux, uz] of AUTOUR) {
        if (laForme(x + ux, y, z + uz) || laForme(x + ux, y + 1, z + uz)) {
          const l = Math.hypot(dx, dz);
          if (l > 0) { dx /= l; dz /= l; }
          vy = -6;
          break;
        }
      }
    }
    const l = Math.hypot(dx, vy, dz);
    return l > 0 ? [dx / l, dz / l] : [0, 0];
  };

  /*
   * Le retrait qui sépare deux plans confondus — **latéral seulement**.
   *
   * Le jeu recule ses faces de fluide d'un millième de bloc, pour qu'elles ne
   * tombent pas exactement dans le plan de celles du bloc qu'elles baignent.
   * Ici les positions sont rangées en entiers courts : un millième s'arrondit
   * à rien dès que la structure grandit. On prend donc le plus grand des deux,
   * le millième du jeu ou deux crans de quantification.
   *
   * Il ne s'applique qu'aux quatre flancs, jamais à la hauteur. Appliqué au
   * dessus et au dessous, il raccourcissait la nappe des deux bouts, et deux
   * blocs empilés se retrouvaient séparés de **deux** retraits : sur la ferme
   * de Quentin, 0,0166 bloc, soit un liseré sombre de cinq pixels à chaque
   * frontière d'une coulée de lave. La hauteur, elle, n'a rien à séparer — le
   * dessus d'un fluide surmonté du même n'est pas dessiné, et son dessous posé
   * sur un plein non plus.
   */
  const RETRAIT = Math.max(0.001, 2 * echelle) * 16;

  /** Les quatre coins du dessus, dans l'ordre où mon écriture les attend. */
  const COINS_HAUT = ['no', 'ne', 'se', 'so'];
  /** Pour chaque flanc, les deux coins que porte son arête haute. */
  const FLANCS = {
    north: ['ne', 'no'], south: ['so', 'se'], west: ['no', 'so'], east: ['se', 'ne'],
  };

  /**
   * Les boîtes d'un emplacement de fluide, faces déjà triées.
   *
   * On ne rend que ce qui se voit : rien contre un même fluide — c'est ce qui
   * soude une nappe —, rien contre un bloc plein.
   */
  const boitesDeFluide = (bx, by, bz, desc) => {
    const s = SORTES[desc.sorte];
    const dessin = FLUIDES[desc.sorte];
    const teinte = desc.sorte === 'water' ? TEINTE_EAU : null;
    const voile = desc.sorte === 'water';
    const hs = desc.quantite / 9;
    const hSoi = hauteurNappe(bx, by, bz, s);

    let h = { no: 1, ne: 1, se: 1, so: 1 };
    if (hSoi < 1) {
      const hN = hauteurNappe(bx, by, bz - 1, s);
      const hS = hauteurNappe(bx, by, bz + 1, s);
      const hE = hauteurNappe(bx + 1, by, bz, s);
      const hO = hauteurNappe(bx - 1, by, bz, s);
      h = {
        no: coinNappe(hSoi, hN, hO, bx - 1, by, bz - 1, s),
        ne: coinNappe(hSoi, hN, hE, bx + 1, by, bz - 1, s),
        se: coinNappe(hSoi, hS, hE, bx + 1, by, bz + 1, s),
        so: coinNappe(hSoi, hS, hO, bx - 1, by, bz + 1, s),
      };
    }
    const y = {};
    for (const c of COINS_HAUT) y[c] = 16 * h[c];
    const bas = 0;

    const face = (tex, sommets, coins) => ({
      tex, voile, coins, cull: null, teinte: false, ...(teinte ? { couleur: teinte } : {}), sommets,
    });
    const boites = [];
    const nouvelle = (dir, f) => boites.push({
      from: [0, bas, 0], to: [16, 16, 16], faces: { [dir]: f }, ombre: true, pivot: null,
    });

    /* ---- le dessus ---- */
    const meme = (x, yy, z) => (laNappe(x, yy, z) & HAUT) === s;
    if (!meme(bx, by + 1, bz) && !bouche(bx, by + 1, bz)) {
      const [fx, fz] = sensNappe(bx, by, bz, s, hs, desc.tombe);
      let uv;
      if (fx === 0 && fz === 0) {
        /* Surface au repos : le dessin dormant, posé tel quel sur le bloc. */
        uv = [[0, 0], [16, 0], [16, 16], [0, 16]];
      } else {
        /*
         * Surface en pente : le dessin d'écoulement, tourné dans le sens du
         * courant et pris sur la moitié de sa largeur autour de son centre.
         */
        const angle = Math.atan2(fz, fx) - (Math.PI / 2);
        const si = Math.sin(angle) * 0.25;
        const co = Math.cos(angle) * 0.25;
        const no = [0.5 + (-co - si), 0.5 + (-co + si)];
        const so = [0.5 + (-co + si), 0.5 + (co + si)];
        const se = [0.5 + (co + si), 0.5 + (co - si)];
        const ne = [0.5 + (co - si), 0.5 + (-co - si)];
        uv = [no, ne, se, so].map((p) => [p[0] * 16, p[1] * 16]);
      }
      const tex = (fx === 0 && fz === 0) ? dessin.repos : dessin.pente;
      nouvelle('up', face(tex, [
        [0, y.no, 0], [16, y.ne, 0], [16, y.se, 16], [0, y.so, 16],
      ], uv));
    }

    /* ---- le dessous ---- */
    if (!meme(bx, by - 1, bz) && !bouche(bx, by - 1, bz)) {
      nouvelle('down', face(dessin.repos, [
        [0, bas, 16], [16, bas, 16], [16, bas, 0], [0, bas, 0],
      ], [[0, 0], [16, 0], [16, 16], [0, 16]]));
    }

    /* ---- les quatre flancs ---- */
    for (const [dir, [ca, cb]] of Object.entries(FLANCS)) {
      const d = DELTA[dir];
      if (meme(bx + d[0], by + d[1], bz + d[2]) || bouche(bx + d[0], by + d[1], bz + d[2])) continue;
      const p = { no: [0, 0], ne: [16, 0], se: [16, 16], so: [0, 16] };
      const [ax, az] = p[ca];
      const [ex, ez] = p[cb];
      /* Le plan du flanc recule d'un retrait vers l'intérieur du bloc. */
      const r = { north: [0, RETRAIT], south: [0, -RETRAIT], west: [RETRAIT, 0], east: [-RETRAIT, 0] }[dir];
      nouvelle(dir, face(dessin.pente, [
        [ax + r[0], y[ca], az + r[1]],
        [ex + r[0], y[cb], ez + r[1]],
        [ex + r[0], bas, ez + r[1]],
        [ax + r[0], bas, az + r[1]],
      ], [
        [8, (1 - h[ca]) * 8], [0, (1 - h[cb]) * 8], [0, 8], [8, 8],
      ]));
    }
    return boites;
  };

  /*
   * L'ombre des angles.
   *
   * C'est ce qui manquait pour que le rendu ressemble au jeu. Sans elle, une
   * paroi est une nappe unie et une structure entière paraît en carton : rien
   * ne dit où deux murs se rencontrent. Minecraft assombrit chaque coin selon
   * le nombre de blocs qui le bouchent — deux voisins et le coin diagonal —, et
   * c'est ce dégradé par sommet, plus que les textures, qui donne le relief.
   *
   * On la calcule sur les blocs pleins seulement : eux forment les surfaces où
   * elle se lit, et l'épargner aux échafaudages et aux torches évite de payer
   * trois lectures par sommet pour un résultat invisible.
   *
   * Les valeurs ne sont pas choisies : elles sont celles du jeu, lues dans ses
   * propres classes. `BlockModelLighter` moyenne **quatre** échantillons — le
   * 0,25 est là, en clair, dans sa réserve de constantes — et `BlockBehaviour`
   * donne **0,2** à un bloc plein contre 1 à l'air. D'où la suite ci-dessous,
   * d'un vingtième d'écart régulier. Une première version portait des nombres
   * inventés, d'allure juste mais d'échelle fausse : les angles y étaient trop
   * clairs et les creux ne se creusaient pas.
   */
  const OMBRES = [0.4, 0.6, 0.8, 1];
  const ambiance = (bx, by, bz, dir, p) => {
    const n = DELTA[dir];
    const ox = bx + n[0];
    const oy = by + n[1];
    const oz = bz + n[2];
    // Les deux axes du plan de la face, et de quel côté penche ce coin.
    const d1 = [0, 0, 0];
    const d2 = [0, 0, 0];
    let vu = 0;
    for (let i = 0; i < 3; i++) {
      if (n[i] !== 0) continue;
      (vu++ === 0 ? d1 : d2)[i] = p[i] > 8 ? 1 : -1;
    }
    const a = bouche(ox + d1[0], oy + d1[1], oz + d1[2]) ? 1 : 0;
    const b = bouche(ox + d2[0], oy + d2[1], oz + d2[2]) ? 1 : 0;
    // Deux côtés bouchés : le coin ne change plus rien, il est déjà noir.
    const c = a && b ? 1 : (bouche(ox + d1[0] + d2[0], oy + d1[1] + d2[1], oz + d1[2] + d2[2]) ? 1 : 0);
    return OMBRES[3 - (a + b + c)];
  };

  /*
   * Un seul parcours décrit, deux usages : compter d'abord, écrire ensuite.
   * Répéter le corps de boucle serait le meilleur moyen que les deux passes
   * divergent un jour.
   */
  let cullees = 0;
  const parcourir = (emettre) => {
    cullees = 0;
    for (let i = 0; i < n; i++) {
      const e = geo[etats[i] - 1];
      if (!e) continue;
      const bx = positions[i * 3];
      const by = positions[i * 3 + 1];
      const bz = positions[i * 3 + 2];
      /*
       * Deux écarts, avant tout travail sur les boîtes : le bloc est masqué,
       * ou son étage n'est pas de ceux qu'on rebâtit. Le second est ce qui
       * rend la reconstruction partielle rapide — la boucle traverse bien les
       * cinq cent mille blocs, mais n'en ouvre que quelques milliers.
       */
      if (masques && masque(i)) continue;
      if (etagesVoulus && !etagesVoulus.has(etageDe(by))) continue;
      let boites = e.boites.length ? e.boites : SANS_MODELE;
      /*
       * Un fluide se rebâtit ici, où l'on voit ses voisins : sa surface penche
       * et le modèle, qui ne connaît qu'un bloc, ne pouvait donner qu'une
       * boîte plate. Celle-ci reste dans l'entrée pour qui n'a pas de grille —
       * une vignette de palette — et cède la place dès qu'on en a une.
       */
      if (e.fluide && nappe) {
        boites = boites.filter((b) => !b.fluide).concat(boitesDeFluide(bx, by, bz, e.fluide));
      }
      for (let bi = 0; bi < boites.length; bi++) {
        const b = boites[bi];
        for (const dir in b.faces) {
          const f = b.faces[dir];
          /*
           * Une face collée à un voisin ne se dessine pas — mais la coupe par
           * couches peut retirer ce voisin. On sépare donc les faces cachées
           * **par le dessous ou le dessus**, qu'un trait de coupe découvre, de
           * celles cachées de côté, que rien ne découvrira jamais : la coupe
           * est horizontale. Les premières attendent dans leur propre tampon
           * au lieu d'être perdues, et le dessous des escaliers cesse de
           * manquer dès qu'on ôte le sol.
           */
          let cachee = 0;
          if (f.cull) {
            const d = DELTA[f.cull] || DELTA[dir];
            const nx = bx + d[0];
            const ny = by + d[1];
            const nz = bz + d[2];
            /* Un voisin plein la cache — ou son pareil, si c'est une vitre. */
            if (d && (bouche(nx, ny, nz) || memeQue(nx, ny, nz, familles[etats[i] - 1]))) {
              if (!d[1]) { cullees++; continue; }
              cachee = d[1] < 0 ? 1 : 2;
            }
          }
          emettre(i, bx, by, bz, b, dir, f, cachee);
        }
      }
    }
    /* Puis les entités, qui ne masquent rien et que rien ne masque. */
    for (const e of posees) {
      /* Le même écart que pour les blocs : hors des étages demandés, rien. */
      if (etagesVoulus && !etagesVoulus.has(etageDe(e.y))) continue;
      for (const b of e.boites) {
        for (const dir in b.faces) emettre(-1, e.x, e.y, e.z, b, dir, b.faces[dir], 0);
      }
    }
  };

  /*
   * Deux familles de faces, et elles ne se dessinent pas de la même manière.
   *
   * Ce qui est opaque ou simplement ajouré — la pierre, les feuilles, un
   * échafaudage — se dessine d'un bloc, chaque fragment gardant ou jetant sa
   * place. Ce qui est **translucide** — le verre, la glace — doit se mélanger à
   * ce qu'il y a derrière, donc passer après, sans écrire dans le tampon de
   * profondeur. Les tenir séparés dès le maillage évite de trier quoi que ce
   * soit au moment de dessiner.
   */
  /*
   * Deux règles, et il faut les deux.
   *
   * Le sprite décide d'abord : un dessin dont des pixels sont à demi
   * transparents doit se mélanger au fond. C'est ce qui range la glace, le
   * slime, le miel et le verre teinté.
   *
   * Puis le jeu peut passer outre. Depuis la 26, une référence de texture
   * porte `force_translucent` — le mot **force** dit bien qu'il s'agit d'une
   * dérogation, non de la règle. Elle sert au verre ordinaire et aux vitres,
   * dont le dessin est en tout ou rien et que l'alpha seul rangerait au
   * découpé.
   *
   * Vérifié sur les 1 198 blocs du jeu : aucune des deux règles ne contient
   * l'autre. Le sprite en attrape huit que le drapeau ignore, le drapeau en
   * attrape deux que le sprite ne pouvait pas voir.
   */
  const voile = (f) => {
    if (f.voile) return true;
    if (!f.tex) return false;
    const t = m.textures[f.tex];
    return t !== undefined && !!m.translucide && m.translucide[t] === '1';
  };

  /*
   * Les entités posées dans le plan : bateaux, wagons, cadres d'objet.
   *
   * Elles ne sont pas dans la grille — leur place est **fractionnaire** et leur
   * lacet quelconque — et elles ne cachent rien ni ne se font cacher. On les
   * prépare une fois pour les deux passes : chaque pose reçoit les boîtes de sa
   * forme, augmentées du pivot de son lacet autour de son propre axe.
   *
   * Un cadre fait exception : c'est un modèle de bloc, qui se pose dans son
   * emplacement et non sur la position de l'entité — celle-ci est contre la
   * paroi, à un demi-bloc du centre.
   */
  const formes = new Map();
  for (const e of m.entites || []) formes.set(e.clef, e);
  const posees = [];
  for (const p of (m.modele.entites || [])) {
    const forme = formes.get(p.clef);
    if (!forme || !forme.boites.length) continue;
    const angle = (forme.lacet || 0) - (Number(p.lacet) || 0);
    const biais = angle ? { axe: 'y', angle, origine: [0, 0, 0], rescale: false } : null;
    const boites = biais
      ? forme.boites.map((b) => ({ ...b, pivot: b.pivot ? [].concat(b.pivot, biais) : biais }))
      : forme.boites;
    posees.push({
      x: forme.cadre ? Math.floor(p.x) : p.x,
      y: forme.cadre ? Math.floor(p.y) : p.y,
      z: forme.cadre ? Math.floor(p.z) : p.z,
      boites,
    });
  }

  /* ------------------------------------------------ passe 1 : les comptes */

  /*
   * Six tampons par étage : ce qui se voit en toutes circonstances, ce que
   * découvre la coupe du bas, ce que découvre celle du haut — et pour chacun
   * l'opaque et le translucide, qui ne passent pas au même moment.
   */
  const NOMS = ['opaque', 'translucide', 'basOpaque', 'basTranslucide', 'hautOpaque', 'hautTranslucide'];
  const bacDe = (f, cachee) => cachee * 2 + (voile(f) ? 1 : 0);
  const compte = NOMS.map(() => new Uint32Array(taille.y));
  parcourir((i, bx, by, bz, b, dir, f, cachee) => { compte[bacDe(f, cachee)][etageDe(by)]++; });

  /* ------------------------------------------------ passe 2 : le garnissage */

  const etages = [];
  const curseur = NOMS.map(() => new Uint32Array(taille.y));
  let octets = 0;
  /*
   * `trie` réserve de quoi ordonner les faces plus tard.
   *
   * Une face translucide n'écrit pas dans le tampon de profondeur, et le
   * mélange employé — la source par son alpha, le fond par ce qui reste — donne
   * le plus de poids à la **dernière dessinée**. L'ordre décide donc du
   * résultat : du plus loin au plus près, une façade de verre s'épaissit
   * couche après couche et finit par cacher ce qu'il y a derrière ; dans un
   * ordre quelconque, l'intérieur d'une ferme transparaît à travers sa vitre.
   *
   * Le tri se fait au dessin, la distance dépendant de la caméra. Pour ne pas
   * relire quatre sommets par face à chaque fois, on garde ici le centre de
   * chacune, dans la même échelle entière que les positions.
   */
  const faire = (y, f, trie) => {
    if (!f) return null;
    const tampon = new ArrayBuffer(f * 4 * PAS);
    const indices = new Uint32Array(f * 6);
    for (let k = 0; k < f; k++) {
      const v = k * 4;
      const t = k * 6;
      indices[t] = v; indices[t + 1] = v + 1; indices[t + 2] = v + 2;
      indices[t + 3] = v; indices[t + 4] = v + 2; indices[t + 5] = v + 3;
    }
    const centres = trie ? new Uint16Array(f * 3) : null;
    octets += tampon.byteLength + indices.byteLength + (centres ? centres.byteLength : 0);
    return {
      y, faces: f, tampon, indices, centres, court: new Uint16Array(tampon), octet: new Uint8Array(tampon),
    };
  };
  for (let y = 0; y < taille.y; y++) {
    /*
     * Un étage hors de la demande rend `null` — ce qui veut dire « garde le
     * tien », et non « il est vide ». L'appelant ne remplace que ce qu'il a
     * demandé ; c'est à lui de savoir lesquels.
     */
    if (etagesVoulus && !etagesVoulus.has(y)) { etages.push(null); continue; }
    /* Les bacs impairs sont les voilés : eux seuls auront à se trier. */
    const t = NOMS.map((_, k) => faire(y, compte[k][y], (k % 2) === 1));
    etages.push(t.some(Boolean) ? Object.fromEntries([['y', y], ...NOMS.map((nom, k) => [nom, t[k]])]) : null);
  }

  parcourir((i, bx, by, bz, b, dir, f, cachee) => {
    const bac = bacDe(f, cachee);
    const ey = etageDe(by);
    const et = etages[ey][NOMS[bac]];
    const nf = curseur[bac][ey]++;
    const place = f.tex ? m.textures[f.tex] : undefined;
    /*
     * Une face donne parfois ses sommets elle-même.
     *
     * Une boîte suffit à presque tout : ses six faces se déduisent de deux
     * coins. Mais la surface d'un fluide n'est pas une boîte — ses quatre coins
     * n'ont pas la même hauteur —, et un flanc de fluide est un trapèze. Ces
     * faces-là portent leur quadrilatère, dans le même ordre de coins.
     */
    const coins = f.sommets || COINS[dir](b.from, b.to);

    /*
     * Les coordonnées de texture arrivent **par coin**, déjà réglées.
     *
     * La rotation propre au modèle, celle du blockstate et le verrou uvlock ont
     * tous été appliqués à la résolution, là où la boîte d'origine était encore
     * connue — ici on ne saurait plus les distinguer. Ne restent que les boîtes
     * de secours des blocs sans modèle, qui n'ont pas de texture et se
     * contentent de la règle par défaut.
     */
    let tourne = f.coins;
    if (!tourne) {
      const uv = uvParDefaut(dir, b.from, b.to);
      tourne = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    }

    const ombre = b.ombre === false ? 1 : OMBRE[dir];
    // Les modèles qui refusent l'occlusion — torches, redstone — la refusent
    // dans le jeu aussi ; et sur une boîte qui ne touche pas les bords du bloc
    // elle n'aurait aucun sens.
    const avecAmbiance = i >= 0 && occupe && b.ombre !== false && cubes[etats[i] - 1];
    let cr = 255; let cg = 255; let cb2 = 255; let alpha = 255;
    if (place === undefined) {
      // Sans texture : la couleur moyenne du bloc, déjà calculée pour la carte.
      // L'alpha à zéro dit au shader de s'en tenir à cette couleur.
      if (i >= 0) { cr = couleurs[i * 3]; cg = couleurs[i * 3 + 1]; cb2 = couleurs[i * 3 + 2]; }
      alpha = 0;
    } else if (f.couleur) {
      /*
       * Une face qui porte sa propre teinte : l'eau des blocs noyés. Elle ne
       * peut pas prendre la couleur moyenne du bloc — un escalier de chêne
       * noyé donnerait de l'eau brune.
       */
      [cr, cg, cb2] = f.couleur;
    } else if (f.teinte) {
      /*
       * Une face « teintée » porte une texture en niveaux de gris que le jeu
       * colore : l'herbe et les feuilles selon le biome, la redstone selon sa
       * charge, l'eau selon l'endroit. Sans biome à consulter, on reprend la
       * couleur moyenne du bloc — celle qui sert déjà à la carte. Une teinte
       * végétale unique aurait rendu la redstone verte.
       */
      if (i >= 0) { cr = couleurs[i * 3]; cg = couleurs[i * 3 + 1]; cb2 = couleurs[i * 3 + 2]; }
    }
    for (let k = 0; k < 4; k++) {
      const p = pivoterTout(coins[k], b.pivot);
      const s = (nf * 4 + k) * 8;                 // en entiers courts
      et.court[s] = coder(bx + p[0] / 16);
      et.court[s + 1] = coder(by + p[1] / 16);
      et.court[s + 2] = coder(bz + p[2] / 16);
      // Quelques modèles débordent volontairement de leur texture pour la
      // répéter ; un entier court non signé ne le sait pas, on borne.
      et.court[s + 3] = borne(tourne[k][0]);
      et.court[s + 4] = borne(tourne[k][1]);
      et.court[s + 5] = place === undefined ? 0 : place;
      const f2 = ombre * (avecAmbiance ? ambiance(bx, by, bz, dir, coins[k]) : 1);
      const o = (nf * 4 + k) * PAS + 12;
      et.octet[o] = cr * f2;
      et.octet[o + 1] = cg * f2;
      et.octet[o + 2] = cb2 * f2;
      et.octet[o + 3] = alpha;
    }
    /* Le centre de la face, que le tri par distance relira au dessin. */
    if (et.centres) {
      const s0 = nf * 4 * 8;
      const c = nf * 3;
      for (let j = 0; j < 3; j++) {
        et.centres[c + j] = (et.court[s0 + j] + et.court[s0 + 8 + j]
          + et.court[s0 + 16 + j] + et.court[s0 + 24 + j]) >> 2;
      }
    }
  });

  const somme = (t) => t.reduce((a, b2) => a + b2, 0);
  const faces = compte.reduce((a, t) => a + somme(t), 0);
  return {
    etages, echelle, marge: MARGE, faces, cullees, octets,
    translucides: somme(compte[1]) + somme(compte[3]) + somme(compte[5]),
    /* Ce qu'un trait de coupe pourra découvrir, et qui dort en attendant. */
    decouvrables: compte.slice(2).reduce((a, t) => a + somme(t), 0),
  };
}
