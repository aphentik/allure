# Allure

Outil de pacing pour cyclosportives : import d'une trace GPX, plan watts col par col, plan nutrition, météo et vent à l'heure de passage, carte du parcours, exports PDF, sticker top‑tube et GPX/TCX enrichi pour compteur.

Site statique, sans build : `index.html` + `css/app.css` + modules ES dans `js/`.

## Lancer en local

Les modules ES ne se chargent pas depuis un fichier local (`file://`). Servir le dossier :

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000/
```

Sur GitHub Pages, publier le dossier tel quel.

Lien profond : `index.html?gpx=<url-du-gpx>` charge directement une trace (même origine ou CORS autorisé). `index.html?race=<url.json>` charge un fichier course Allure.

## Structure

| Fichier | Rôle |
|---|---|
| `js/main.js` | démarrage, câblage des événements, langue, thème |
| `js/state.js` | état partagé, pub/sub, persistance (IndexedDB pour la course, localStorage pour les préférences), export/import JSON |
| `js/i18n.js` | chaînes FR/EN, formats |
| `js/gpx.js` | parseur GPX (DOMParser), distance cumulée, lissage, rééchantillonnage 100 m, D+ |
| `js/segment.js` | détection automatique montées / descentes / plat, fusion, scission |
| `js/waypoints.js` | classification des `<wpt>` (ravito, fontaine, barrière, danger, sommet) et accrochage à la trace |
| `js/physics.js` | modèle physique de vitesse, calcul des segments (source unique), heures de passage |
| `js/plan.js` | timeline du plan, données partagées par les exports |
| `js/nutrition.js` | plan glucides / hydratation / arrêts ravito |
| `js/weather.js` | points météo dérivés du parcours, Open‑Meteo, vent le long de la trace (face / travers / dos) |
| `js/profile.js` | profil SVG interactif, bande vent |
| `js/map.js` | carte Leaflet : trace colorée par segment, marqueurs, flèches de vent |
| `js/editor.js` | panneau ⚙ Configurer : import, ajout rapide de ravitos, réglages de détection, éditeur de segments et de points |
| `js/osm.js` | enrichissement OpenStreetMap (Overpass) : noms de cols, fontaines |
| `js/export.js` | PDF, stickers, GPX / TCX |
| `js/checklist.js` | checklist d'avant‑course |

## Fichier course (`.json`, version 1)

```json
{
  "v": 1, "name": "Ma course", "date": "2026-07-19", "start": "07:00",
  "track": { "pts": [[lat, lon, ele], ...] },
  "segments": [{ "id": "s1", "type": "climb|flat|descent", "name": "", "from": 0, "to": 12.3,
                 "grad": 6.9, "delta": -0.02, "key": true, "cue": "", "speedKmh": null }],
  "waypoints": [{ "id": "w1", "kind": "ravito|fountain|barrier|danger|other", "km": 38.5,
                  "name": "", "desc": "", "time": "11:28" }],
  "settings": { "ftp": 250, "kg": 75, "bikeKg": 8, "obj": "diesel", "advIF": 0.75,
                "flatIF": 0.62, "draft": 0.2, "descentCapKmh": 48,
                "seg": { "minGrad": 2.5, "minKm": 1.5, "dipKm": 2.5 } }
}
```

- `delta` : décalage d'intensité de la montée par rapport à l'objectif (fraction de FTP).
- `speedKmh` : vitesse forcée d'un segment plat / descente (sinon modèle physique).
- Les ravitos reçoivent automatiquement un code `R1…Rn` par ordre kilométrique (`ARR` près de l'arrivée).

## Modèle

- Toute la trace est intégrée par pas de 100 m sur le profil réel (pente, altitude, courbure).
- Montées : puissance constante = FTP × (base de l'objectif + décalage du col), le décalage venant de la durée estimée, de l'altitude et de la position dans la course. Vitesse résolue par la physique (masse coureur + vélo, CdA 0,34, Crr 0,005, rendement 0,97, densité de l'air décroissante avec l'altitude).
- Plat : FTP × `flatIF`, CdA réduit par l'abri (`draftLevel` : seul 0 %, petit groupe 20 %, peloton 40 %).
- Descente (pente < −1,5 %) : roue libre à 30 % FTP, limitée en virage par `v = sqrt(a_lat · g · R)` avec le rayon de courbure `R` de la trace et `a_lat` selon `descLevel` (prudent 0,25 g / ≤ 50 km/h, standard 0,32 g / ≤ 58, confirmé 0,40 g / ≤ 66, expert 0,50 g / ≤ 75).
- Vent : si une prévision existe (date ≤ 16 j), la composante face/dos à l'heure de passage entre dans la traînée (vent à 10 m × 0,7) ; le calcul itère une ou deux fois entre heures de passage et vent.
- Ces réglages ne sont libres qu'en objectif « Avancé » ; les autres objectifs utilisent des présélections (Finir tranquille 58 % · prudent, Gérer l'effort 62 % · standard, Performer 66 % · confirmé).
- Calibration : `scripts/calib/` compare le modèle à des activités réelles (voir plus bas) pour régler ces constantes.

## Versions

La version affichée en bas de page vient de `js/version.js` : tag de release + horodatage de build, écrit par le hook `pre-commit` à chaque commit (installer une fois avec `scripts/install-hooks.sh`). La page compare cet horodatage au dernier commit de `main` via l'API GitHub et signale si elle est en retard (cache Pages ≈ 10 min).

Publier une version :

```bash
scripts/release.sh 0.4.0 "Notes de version"
```

(met à jour `js/version.js`, commit, tag `v0.4.0`, push, release GitHub).

## Calibration (développement)

```bash
node scripts/calib/run.mjs activites/        # FIT ou GPX horodatés, dossier ignoré par git
```

Pour chaque activité : reconstruction de la trace, segmentation automatique, puis comparaison réel / prévu par segment : à puissance réelle (FIT avec capteur) pour juger la physique, et au pacing Allure pour juger les cibles. Rapport dans `scripts/calib/REPORT.md`, grille de recherche sur CdA, Crr, masse équipement, fraction roue libre et `a_lat`.

## Idées pour plus tard

- Partage d'un plan par URL (fichier course compressé dans le hash).
- Comparaison de deux scénarios d'intensité côte à côte.
- Vagues de départ optionnelles si une course les publie.
- Coloration de la trace par pente instantanée.
