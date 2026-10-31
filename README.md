# PIXLCAM

A glitch camera that runs in the phone's browser. You get a live camera view with stackable effects, and you can save the photo to your phone. It's a website (a PWA), so there's no App Store and no Apple developer fee. Add it to your home screen and it opens full-screen like a normal app.

## Effects

Each effect has an **Intensity** slider plus its own options. Tap an effect chip to turn it on and open its controls.

| Effect | Options |
| --- | --- |
| **Glitch** | density, block size, displace, corrupt color, speed, seed |
| **RGB Split** | distance, angle, mode (linear / radial / shake) |
| **Pixel Sort** | intensity (how much of the image sorts), tones (dark ↔ light), streak length, ragged edges, direction (any angle), sort by (brightness/hue/sat/R/G/B), sort inside or outside the range. Modelled on the ESP32-P4 camera's sort: real pixels are moved at full resolution, with a per-row cutoff and streak length |
| **Pixelate** | size, shape (square / LED / halftone / LCD) |
| **VHS** | wobble, line jitter, tracking band, color bleed, noise, speed |
| **Dither** | pixel size, levels, pattern (Bayer 8/4, noise), palette (color, mono, Game Boy, amber, cyber, vapor, thermal) |
| **CRT** | scanlines, line size, RGB mask, curvature, vignette |
| **Grain** | amount, size, color grain |
| **Color** | hue, saturation, contrast, brightness, solarize, channel swap, invert |

Other features:
- **Photo / Video**: switch above the shutter. Video records the filtered view live (MP4 where supported), with optional microphone sound. Effects can be changed while recording.
- **Zoom & lenses**: pinch the picture, or tap the zoom buttons. On iPhones with several lenses you get `.5 / 1× / TELE` buttons that switch the physical camera. Elsewhere it uses the phone's hardware zoom when the browser allows it, otherwise a digital zoom.
- **↺ button**: resets every effect in one tap, with **Undo**.
- **Looks**: one-tap presets (VHS Tape, Melt, Shatter, 8-Bit, Corrupt, Vapor, Arcade, 1-Bit, Heat).
- **🎲 button**: random look.
- **Hold the picture**: shows the original, so you can compare.
- **Open a photo**: applies the effects to a picture from your library (you can record a video of a photo with animated effects too).
- **Portrait and landscape**: turn the phone sideways and the controls move to the side; the frame flips with it (3:4 becomes 4:3).
- Frame shapes 3:4, 1:1, 9:16 and 4:3; JPG or PNG; export up to 4096 px.
- Your settings are remembered between visits.

Everything runs on the GPU with WebGL2 shaders, including the pixel sort, which is a real threshold-span sort done with a bitonic sorting network. The photo you save is re-rendered at full resolution with the same settings as the preview.

## Run it on your computer

```bash
node tools/serve.mjs
```

Then open http://localhost:5173. Your laptop webcam works on `localhost`. Add `?demo` to the URL to use a built-in test image instead of the camera.

## Run it on your phone

Browsers only allow camera access over **https**, so the phone needs an https address. Pick one:

**Option A: free hosting (best, permanent URL)**
- **Netlify Drop**: go to https://app.netlify.com/drop and drag this whole folder onto the page. You get an https link right away.
- **GitHub Pages**: push this folder to a GitHub repo, then Settings → Pages → deploy from the `main` branch.
- Cloudflare Pages and Vercel work too. There's no build step; just serve the folder as-is.

**Option B: quick tunnel from your Mac (for testing)**
With `node tools/serve.mjs` running, in another terminal:
```bash
npx localtunnel --port 5173
```
Open the https URL it prints on your phone.

### Install it like an app
- **iPhone (Safari)**: Share button → **Add to Home Screen**.
- **Android (Chrome)**: ⋮ menu → **Install app** / **Add to Home screen**.

### Saving photos and videos
After you take a shot or stop recording, tap **Save**:
- **iPhone**: the share sheet opens. Choose **Save Image** / **Save Video** to put it in Photos. You can also long-press a picture.
- **Android**: the share sheet opens. Pick Photos/Gallery, or long-press the picture.
- **Computer**: the image downloads.

## If the live view stutters
Open settings (the sliders icon) and set **Preview quality** to Low. Pixel Sort and VHS are the heaviest effects. Saved photos are always rendered at full quality.

## Project layout

```
index.html            page structure
css/style.css         styling
js/main.js            app: state, UI, render loop, capture & save
js/effects.js         effect definitions: params + GLSL shaders
js/pixelsort.js       multi-pass GPU pixel sort
js/renderer.js        WebGL2 pipeline (source → effects → screen/export)
js/gl.js              WebGL helpers
js/camera.js          camera access
js/presets.js         Looks + randomizer
js/demo.js            built-in test image
sw.js                 offline support
manifest.webmanifest  install info for home screen
tools/icons.mjs       pixel-art icon designs + renderer
tools/icon-sheet.mjs  labelled comparison sheets → design/
tools/make-icons.mjs  regenerates icons/ from the chosen design
tools/make-gif.mjs    animated glitch GIF of the icon → design/  (node tools/make-gif.mjs 128)
tools/serve.mjs       local dev server
```

### Changing the app icon
The icon is pixel art drawn in code (`tools/icons.mjs`). The current one is option **1E** (`split-black`).
`node tools/icon-sheet.mjs` (or `… split`) renders the comparison sheets in `design/`. To switch icons, set
`APP_ICON` in `tools/make-icons.mjs` to another design id and run `node tools/make-icons.mjs`. On iPhone,
remove and re-add the home-screen icon to see the new one.

### Adding an effect
In `js/effects.js`, add an entry with `params`, a `uniforms(p)` function and a GLSL `fx(vec2 uv)` that returns a color. Then add its id to `PIPELINE` (the order effects are applied in) and `CHIP_ORDER` (the order chips appear in). The Intensity slider and the controls panel are generated for you.

### Renaming
The name appears in `index.html` (title, `apple-mobile-web-app-title`, brand), `manifest.webmanifest`, and the icon letter in `tools/make-icons.mjs`.
