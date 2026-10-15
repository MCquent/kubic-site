# Site vitrine — Kubic

Site statique : aucune dépendance, aucun build. Hébergé sur **GitHub Pages** (dépôt
`MCquent/kubic-site`), l'installeur dans les **Releases** du dépôt de l'application
(`MCquent/kubic`), le domaine `kubicmc.com` restant chez Porkbun (voir « Mettre en ligne »).

```
index.html              la page, en anglais (langue par défaut)
legal.html              mentions légales et confidentialité
version.json            la version publiée — lue par la page ET par l'application
favicon.ico             icône de l'application
assets/css/style.css    thème sombre / clair, repris des variables de l'application
assets/js/i18n.js       moteur de langue
assets/js/lang/         une traduction par fichier : fr, es, de, it, pt
assets/js/main.js       version, thème, menu, apparitions, inventaire, copie de l'empreinte
assets/js/viewer/       le visionneur 3D : moteur de l'application + mise en scène (demo.js)
assets/viewer/          le plan montré en 3D, exporté par l'application, et son image de secours
assets/img/             icône, og.png (aperçu de partage 1200×630), textures du jeu
.nojekyll               dit à GitHub Pages de servir les fichiers tels quels
CNAME                   le domaine du site (kubicmc.com), écrit par GitHub — à garder
downloads/              copie locale de l'installeur, pour publier-site.js — à ne PAS envoyer
                        sur GitHub (l'installeur va dans une Release)
```

## Publier une nouvelle version

Une seule source : [`version.json`](version.json). La page en tire le numéro, le poids, la date,
le lien, l'empreinte SHA-256 et les nouveautés ; l'application y cherche ses mises à jour.

1. Dans le projet de l'application : construire (`tools/construire.js`), puis vérifier
   (`tools/verifier-paquet.mjs`).
2. Ici, dans `version.json` : `version`, `date` (AAAA-MM-JJ), `notes` (en français, ce
   qu'affiche l'application) et leurs traductions pour le site : `notes_en`, `notes_es`,
   `notes_de`, `notes_it`, `notes_pt` (une traduction absente retombe sur l'anglais). Et `url`,
   le lien de la future Release :
   `https://github.com/MCquent/kubic/releases/download/v<version>/Kubic-Setup-<version>.exe`.
3. `tools/publier-site.js "<ce dossier>"` copie l'installeur dans `downloads/` et écrit
   l'empreinte et la taille exactes — l'application refuse un installeur dont l'empreinte ne
   correspond pas. Mettre l'ancien `.exe` de `downloads/` à la corbeille (il reste dans `dist/`).
4. Sur GitHub, **d'abord** la Release, dans le dépôt `MCquent/kubic` : « Releases → Draft a
   new release », tag `v<version>`, joindre le `.exe` de `downloads/`, Publish. **Ensuite**
   `version.json`, dans `MCquent/kubic-site` (« Add file → Upload files » remplace l'ancien) :
   dans cet ordre, le lien annoncé existe toujours.

C'est tout : plus d'objet `RELEASE` à recopier dans `main.js` (le commentaire en tête de
`publier-site.js` qui en parle est périmé). Les valeurs écrites dans `index.html` (« 1.2.0 »,
« 116 MB », la date, l'empreinte, le nom du fichier) ne servent que sans JavaScript ou en ouvrant
la page par double-clic ; on peut les remettre à jour par un rechercher-remplacer, sans urgence.

## Le visionneur 3D

La section « 3D schematic viewer » (`#schematics`), juste après le haut de page : une copie de
l'écran Schematics de l'application (barre de titre, bibliothèque, en-tête du plan, matériaux,
commandes), dont la scène est le **vrai moteur 3D de l'application**, en direct dans le
navigateur, sur un vrai plan — le *720k concrete swapper* de **YaneuraBear**. La bibliothèque à
gauche est décorative ; « Vue à plat » est grisé (« dans l'application »). Le moteur ne démarre
que lorsque la section approche de l'écran (ou 3 s après le chargement), pour ne pas ralentir
l'arrivée sur la page.

- **Le moteur** — `assets/js/viewer/moteur3d.js` et `maillage.js` sont des copies de
  `renderer/js/schematics/` de l'application, avec une seule différence, notée en tête de
  `moteur3d.js` : `this.clavier`, qui ne laisse le moteur écouter le clavier que lorsque le
  visiteur a pris la main (sinon F, et même Ctrl+F, basculeraient le vol pendant la lecture).
  Quand le moteur change dans l'application, recopier les deux fichiers et remettre ce point.
- **Le plan** — `assets/viewer/<nom>.json` et `.bin` (géométrie tirée des modèles du jeu) et
  `atlas-<version>.png` (les seules textures employées : 84 au lieu de 1 374, 66 Ko). Ils sont
  produits par l'application elle-même :

  ```
  ./node_modules/electron/dist/electron.exe tools/exporter-vue-site.js "<plan>" "<dossier du site>"
  ```

  depuis le projet de l'application (Electron en processus principal, **sans**
  `ELECTRON_RUN_AS_NODE`). L'outil dit ensuite quelle valeur donner à `PLAN` en tête de
  `assets/js/viewer/demo.js`.
- **La mise en scène** (`demo.js`) : rotation lente tant que personne n'y touche, découpe par
  couches, recadrage, plein écran, vol libre (touches AZERTY ou QWERTY selon le clavier du
  visiteur), nom du bloc visé, zoom à deux doigts. Sur téléphone, la bibliothèque et la carte
  « Commandes » disparaissent et les matériaux passent sous la vue. La molette ne zoome qu'après
  un clic dans la scène : avant, elle fait défiler la page. Le nom du plan, son auteur, sa
  taille, sa date et la liste complète des matériaux (avec son filtre) sont lus dans le `.json` : changer de plan ne
  demande pas de toucher au HTML. Les valeurs écrites dans le HTML ne servent que sans JS.
- **L'image de secours** — `assets/viewer/<nom>.webp`, montrée pendant le chargement ou si le
  navigateur n'a pas WebGL 2. Pour la refaire : servir le site en local, ouvrir la console du
  navigateur et taper `await kubicVue.affiche()` ; le fichier se télécharge, à poser dans
  `assets/viewer/`.
- **L'auteur** — le nom et l'auteur viennent des métadonnées du fichier et s'affichent dans
  l'en-tête du plan, et `legal.html` le cite (clé `lg.tm.p1`). Pour un autre plan, s'assurer que son auteur est
  d'accord pour qu'il serve de vitrine, et changer cette phrase dans `legal.html` et `lang/*.js`.

## Langues

- L'**anglais** est écrit dans le HTML : c'est ce que voient les moteurs de recherche et les
  visiteurs sans JavaScript.
- Les cinq autres langues de l'application — **français, espagnol, allemand, italien,
  portugais** — sont dans [`assets/js/lang/`](assets/js/lang/), un fichier par langue, chargé
  seulement par les visiteurs qui la choisissent. Chaque fichier donne le texte de chaque élément
  marqué `data-i18n="clé"` (contenu) ou `data-i18n-attr="attribut:clé"`, dans l'ordre de la page ;
  une clé absente reste en anglais.
- Le ton suit celui de l'application : vouvoiement en espagnol (« usted ») et en allemand
  (« Sie »), tutoiement en italien, portugais du Portugal (« ficheiros », « transferir »). Les
  libellés des maquettes reprennent ceux de `renderer/js/lang/` de l'application.
- Pour modifier un texte : l'anglais dans le HTML, puis la même clé dans chaque fichier de
  `lang/`. Dans la console du navigateur, `await KubicI18n.missing('de')` liste les clés qu'une
  langue n'a pas encore.
- Le choix du visiteur (sélecteur de langue de la barre) est mémorisé. Lien direct vers une
  langue : `…/?lang=es`, `?lang=de`…
- Ajouter une langue : son code dans `LANGUES` en tête de `i18n.js`, un fichier `lang/<code>.js`
  (copier `fr.js` et traduire), une `<option>` dans le sélecteur de `index.html` et `legal.html`,
  et un champ `notes_<code>` dans `version.json`.

## Adresse du site et mises à jour de l'application

Les balises de partage (`canonical`, `og:url`, `og:image`) pointent vers **https://kubicmc.com/**,
le domaine du projet. Si le site est servi ailleurs, changer les quatre lignes signalées en tête
de `index.html` et le `canonical` de `legal.html`.

L'application cherche ses mises à jour à l'adresse donnée par `package.json` (clé
`kubic.miseAJour`) : `https://kubicmc.com/version.json`, renseignée le 15 octobre 2026, et
décrite dans son document de confidentialité (« Pour les mises à jour »). Elle était **vide dans
la 1.2.0** déjà distribuée : ses utilisateurs ne seront prévenus d'aucune nouvelle version et
devront revenir une fois sur le site. Les versions construites à partir de maintenant vérifient
au démarrage (réglable dans Réglages → Mises à jour).

Si cette adresse change un jour (autre domaine, autre hébergeur), l'ancienne doit continuer de
servir `version.json` : les versions déjà installées ne connaissent qu'elle.

## Mettre en ligne

Le site sur **GitHub Pages**, l'installeur dans les **Releases** du dépôt de l'application :
gratuit, sans quota de bande passante pour l'installeur. Un dépôt GitHub refuse les fichiers de plus de 100 Mo
(25 Mo par l'envoi depuis le navigateur) : l'installeur ne va donc jamais dans le dépôt lui-même.
L'application suit la redirection des liens de Release et accepte un installeur hébergé n'importe
où en `https://`, pourvu que son empreinte soit celle annoncée.

1. **Dépôt du site** — nouveau dépôt public `MCquent/kubic-site`. « Add file → Upload files » :
   glisser tout le contenu de ce dossier **sauf `downloads/`** (`.nojekyll` compris).
2. **Pages** — Settings → Pages → Source « Deploy from a branch », `main`, `/ (root)`. Le site
   est en ligne à `https://mcquent.github.io/kubic-site/`.
3. **Release** — dans le dépôt existant `MCquent/kubic` (celui du README de l'application) :
   tag `v1.2.0`, joindre `downloads/Kubic-Setup-1.2.0.exe`, Publish. C'est l'adresse que
   `version.json` annonce déjà.
4. **Domaine** — Settings → Pages → Custom domain : `kubicmc.com`. Chez Porkbun, dans le DNS de
   kubicmc.com :
   - supprimer les enregistrements de parking de Porkbun sur `kubicmc.com` et `www` ;
   - 4 enregistrements **A** sur `kubicmc.com` : `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, `185.199.111.153` ;
   - un **CNAME** `www` → `mcquent.github.io` ;
   - ne toucher **ni aux MX** (la messagerie `contact@kubicmc.com`) **ni aux enregistrements des
     joueurs** (`nom.kubicmc.com`, écrits par le service d'adresses) ;
   - une fois le certificat prêt, cocher « Enforce HTTPS ».
5. **Vérifier le domaine** dans les réglages du compte GitHub (Pages → Add a domain, un
   enregistrement TXT chez Porkbun) : personne d'autre ne pourra alors le brancher sur son dépôt.

**Ne pas déplacer les serveurs DNS** de kubicmc.com chez Cloudflare ou un hébergeur : le service
d'adresses des joueurs écrit dans la zone Porkbun par son API, il cesserait de fonctionner. Le
nom `www` est réservé dans ce service : aucun joueur ne peut le réclamer.

## Mentions légales

`legal.html` dit qui publie le site (un particulier, contact `contact@kubicmc.com`, déjà public
dans l'application), qui l'héberge (GitHub, Inc.) et reprend le document de confidentialité de
l'application. Le téléphone de GitHub qui y figure (+1 415 735 4488) vient du registre RIPE, pas
d'une page de GitHub : à vérifier. Si le site change d'hébergeur, changer la clé `lg.host.p` dans
`legal.html` et dans chaque fichier de `assets/js/lang/`.

## Prévisualiser en local

Le double-clic sur `index.html` suffit pour la mise en page, mais un navigateur ne lit pas
`version.json` depuis un fichier local : la page garde alors ses valeurs écrites en dur et
n'affiche pas les nouveautés. Pour tout voir, servir le dossier en HTTP — par exemple avec
l'extension *Live Server* de VS Code, ou `npx --yes serve .` si Node.js est installé.

## Détails utiles

- **Thème** — sombre par défaut, bouton lune/soleil, choix mémorisé ; la préférence système est
  respectée à la première visite. Thème et langue sont posés dans le `<head>`, avant le premier
  affichage : pas d'éclair de la mauvaise version.
- **La maquette du gestionnaire de serveurs** (section Servers) n'est pas une image : la fenêtre
  de l'application est reconstruite en HTML/CSS d'après ses vraies captures. Tout y est en `em`
  et sa police suit la largeur de son conteneur : sur téléphone elle devient une miniature
  fidèle au lieu de s'empiler. Elle reste nette, suit le thème et la langue.
- **L'inventaire** utilise les vraies textures 16×16 du jeu (`assets/img/items/`, 30 Ko), rendues
  sans lissage. Le contenu des cases se change dans les tableaux `ARMOR`, `BAG` et `BAR` de
  `main.js` : `['nom_de_texture', quantité, usure en %]`. Ces textures appartiennent à Mojang ;
  le pied de page le mentionne, gardez le site non commercial.
- **`og.png`** (l'aperçu sur Discord et les réseaux) montre l'icône et une vue du plan rendue par
  le moteur ; à refaire si l'un ou l'autre change.
- **Aucun script tiers**, aucune police distante, aucun cookie. Deux entrées de stockage local
  (`kubic-theme`, `kubic-lang`), purement fonctionnelles : pas de bandeau de consentement à
  prévoir.
- Contrastes vérifiés : tous les textes à lire dépassent 4,5:1 dans les deux thèmes (`--txt-4`
  est réservé au décor des maquettes).
