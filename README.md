<p align="center"><img src="docs/banner.png" alt="RPD Studio banner" width="100%"></p>

<p align="center">
  <img src="https://img.shields.io/badge/PixiJS-8.23-f07ab3?style=for-the-badge&labelColor=221d1f" alt="PixiJS 8.23">
  <img src="https://img.shields.io/badge/@pixi/3d-0.1-f3c138?style=for-the-badge&labelColor=221d1f" alt="@pixi/3d 0.1">
  <img src="https://img.shields.io/badge/Vite-static_site-c9d3b0?style=for-the-badge&labelColor=221d1f" alt="Vite">
  <img src="https://img.shields.io/badge/for-BDS_students-f8f2e9?style=for-the-badge&labelColor=221d1f" alt="For BDS students">
</p>

<p align="center"><b>A 3D lab for designing removable partial dentures.</b><br>
Survey a mandibular cast, let it classify itself, place rests and clasps, and watch every decision get checked against the textbook.</p>

---

## 🦷 The four steps

| | Step | What you do |
|---|---|---|
| **1** | **Case** | Pick a Kennedy preset or tap teeth to extract them. Class, modifications and Applegate notes update live. |
| **2** | **Survey** | Tilt the table, keep the rod vertical. Height of contour, undercut map and gauge lines redraw on every tooth. Tap to measure. |
| **3** | **Design** | Rests, Akers, RPI, wrought-wire clasps, lingual bar or plate. Saddles and teeth fill every span. |
| **4** | **Check** | A scored list of design rules, from rest placement to indirect retention ahead of the fulcrum line. |

## 📸 Screens

<table>
<tr>
<td width="60%"><img src="docs/design-occlusal.png" alt="Occlusal view with framework"><br><sub><b>Design</b> · Class I framework with RPI clasps, lingual bar and the fulcrum line</sub></td>
<td width="40%" rowspan="2"><img src="docs/phone-check.png" alt="Phone check tab"><br><sub><b>Check</b> · works on phones too</sub></td>
</tr>
<tr>
<td><img src="docs/survey-tilt.png" alt="Survey with tilt"><br><sub><b>Survey</b> · 8° anteroposterior tilt, undercut map and gauge line</sub></td>
</tr>
<tr>
<td colspan="2"><img src="docs/design-side.png" alt="Side view of the framework"><br><sub><b>Side view</b> · saddle, replacement teeth and I-bar on the distal-extension side</sub></td>
</tr>
</table>

## ✨ What's inside

- **Kennedy + Applegate** classification, including rule 4 (unreplaced second molars), rule 7 and rule 8 (Class IV)
- **Surveyor** with ±15° anteroposterior and lateral tilt; undercut bands at **<0.25 / 0.25–0.5 / 0.5–0.75 / >0.75 mm**
- **Clasps that respect the survey**: tips sit at the undercut their alloy needs, so a bad path of insertion fails the check
- **Framework parts**: occlusal and incisal rests, Akers, RPI, wrought-wire combination clasps, lingual bar or plate (chosen from sulcus depth), saddles and replacement teeth
- **Suggest textbook design** for any case, then break it and see what fails
- **Comic toon look**: ink outlines, pink / mustard / sage palette, cream paper

## 🚀 Run it

```bash
npm install
npm run dev      # local
npm run build    # static site in dist/ (Vercel / Netlify ready)
```

## 🗂️ Code map

| File | What it holds |
|---|---|
| `src/kennedy.js` | Kennedy + Applegate logic, presets |
| `src/anatomy.js` | Procedural mandibular cast, 14 teeth, gingiva, base |
| `src/survey.js` | Height of contour, undercut depth map, gauge lines |
| `src/design.js` | Framework builder, design rules, textbook suggestion |
| `src/main.js` | PixiJS 3D scene, toon materials, outline pass, UI |

## ⚠️ Disclaimer

Teaching model. Anatomy is simplified and the rules follow common textbook guidance; check them against your faculty's protocol. **Not for clinical use.**

<p align="center"><sub>Built by <b>Swapnil Agrawal (BDS intern)</b> · Pacific Dental College & Hospital, Udaipur</sub></p>
