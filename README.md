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

- Montées : vitesse résolue depuis la puissance cible (FTP × intensité), masse coureur + vélo, pente moyenne, CdA 0,34, Crr 0,005.
- Plat : FTP × `flatIF`, CdA réduit par l'abri (`draftLevel` : seul 0 %, petit groupe 20 %, peloton 40 %).
- Descente : 30 % FTP en roue libre, plafonné selon `descLevel` (prudent 40, standard 48, confirmé 55, expert 62 km/h). Le temps est intégré tous les 100 m sur le profil réel.
- Ces trois réglages ne sont libres qu'en objectif « Avancé » ; les autres objectifs utilisent des présélections (Finir tranquille 58 % · prudent, Gérer l'effort 62 % · standard, Performer 66 % · confirmé).
- OpenStreetMap : à l'import, noms des cols via Photon (reverse geocoding komoot : cols et selles à moins de 600 m, sinon sommets et lieux à moins d'1 km ; repli Overpass), et points d'eau potable via Overpass (`amenity=drinking_water`, robinets, sources potables) à moins de 80 m de la trace. Serveurs Overpass : OSM France, overpass-api.de, mail.ru. Réponses mises en cache 7 jours dans le navigateur. Bouton « Actualiser depuis OpenStreetMap » dans ⚙ Configurer.
- Météo : Open‑Meteo, prévisions ≤ 16 jours. Vent échantillonné tous les ~5–8 km, comparé au cap du coureur à l'heure de passage.

## Versions

La version affichée en bas de page vient de `js/version.js` : tag de release + horodatage de build, écrit par le hook `pre-commit` à chaque commit (installer une fois avec `scripts/install-hooks.sh`). La page compare cet horodatage au dernier commit de `main` via l'API GitHub et signale si elle est en retard (cache Pages ≈ 10 min).

Publier une version :

```bash
scripts/release.sh 0.4.0 "Notes de version"
```

(met à jour `js/version.js`, commit, tag `v0.4.0`, push, release GitHub).

## Idées pour plus tard

- Partage d'un plan par URL (fichier course compressé dans le hash).
- Comparaison de deux scénarios d'intensité côte à côte.
- Vagues de départ optionnelles si une course les publie.
- Coloration de la trace par pente instantanée.
