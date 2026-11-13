# RPD Studio

A 3D removable partial denture design lab for BDS students, built with **PixiJS 3D** (`@pixi/3d`).

Survey a mandibular cast, let the app classify it (Kennedy + Applegate's rules), design the framework, and get every decision checked.

## What it does

1. **Case** – pick a Kennedy class preset or tap teeth to extract/restore them. Classification updates live, with spans, modification spaces and Applegate notes (rule 4 for unreplaced second molars, rule 8 for Class IV).
2. **Survey** – the analyzing rod stays vertical while you tilt the table (anteroposterior and lateral). Every tooth gets a height-of-contour line, an undercut map (<0.25 / 0.25–0.5 / 0.5–0.75 / >0.75 mm) and an iso-depth line for the chosen gauge. Tap any point to read its undercut depth.
3. **Design** – place rests (occlusal, incisal on canines), Akers clasps, RPI systems, wrought-wire combination clasps, and a lingual bar or plate. Saddles and replacement teeth are added for every edentulous span. Clasp tips are seated at the undercut their alloy needs, measured from the survey, so tilting the cast changes what works.
4. **Check** – a scored list of design rules: rests on every abutment, rest position next to the space, mesial rests and stress-releasing retainers on distal-extension abutments, indirect retention anterior to the fulcrum line, cross-arch retention (tripod / quadrilateral), tip undercut available at this path of insertion, and lingual bar vs plate from the lingual sulcus depth.

## Tech

- `pixi.js` 8.23 + `@pixi/3d` 0.1 (WebGL2 / WebGPU), toon materials with an ink `OutlinePass`
- Procedural anatomy in millimetres: crowns built from superellipse cross-sections with real buccal/lingual heights of contour, arch from a Bézier curve, swept gingiva and stone base
- Surveyor maths in `src/survey.js`, Kennedy logic in `src/kennedy.js`, framework + rules in `src/design.js`
- 2D Pixi overlay for FDI labels, fulcrum line tag and the undercut callout

## Run

```bash
npm install
npm run dev      # local
npm run build    # static site in dist/ (deploys as-is to Vercel/Netlify)
```

## Disclaimer

Teaching model. Anatomy is simplified and rules follow common textbook guidance; verify against your faculty's protocol. Not for clinical use.

Built by Swapnil Agrawal (BDS intern).
