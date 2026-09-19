# Game assets

This directory is the local **staging area** for game media that is published to
Cloudflare R2. It is not part of the web bundle and not part of the API image.

## Where each kind of asset lives

| Kind | Where | Examples |
|---|---|---|
| App shell | `apps/web/public/` (served at `/`) or `apps/web/src/assets/` (imported and hashed by Vite) | favicon, app icon, logo, a handful of tiny UI glyphs, a small in-app font |
| Game media | Cloudflare R2 bucket `app-assets`, delivered through a public CDN domain | companion/character art, buildings and world art, backgrounds, item/cosmetic icons, music, sound effects, voice lines, animations, video |
| Authoring sources | a separate asset repository or shared drive, **never this repo** | `.psd`, `.blend`, `.aup`, `.wav` masters, layered `.svg` sources |

Rule of thumb: if it must ship with the first paint, or it is a few KB of UI
chrome, bundle it with the web app. Anything larger, versioned, or likely to
change without a web redeploy belongs in R2.

## Local staging layout

```
assets/
  game/
    art/
    audio/
    ui/
    video/
```

Files under `assets/game/` are gitignored (see `.gitignore`) so binaries are
never committed. Only this README and `.gitkeep` placeholders are tracked. The
folder mirrors the R2 key layout, which makes uploads a straight sync.

## R2 layout

```
app-assets/
  <asset-set-version>/          # immutable; e.g. v000001 or a content hash
    manifest.json
    art/companion/<id>.webp
    art/buildings/<id>.webp
    audio/sfx/<id>.ogg
    audio/music/<id>.ogg
    ui/icons/<id>.webp
```

- Bump the asset-set version whenever any object changes. Do not overwrite a
  published object in place, so long-lived cache entries stay correct.
- `manifest.json` maps logical ids such as `companion.neko.idle` to the object
  key, a checksum, and optional dimensions/duration. The client resolves assets
  through the manifest so media can change without rebuilding the web app.
- Serve from an R2 public custom domain behind Cloudflare, with
  `Cache-Control: public, max-age=31536000, immutable` on versioned objects.
- Never proxy asset bytes through Cloud Run; that adds egress cost and latency
  with no benefit.

## Naming

- Logical ids are lower-kebab-case and namespaced: `art.companion.neko.idle`,
  `audio.sfx.alarm-fire`, `ui.icon.credits`.
- Images: WebP (AVIF where supported). Audio: Ogg/Opus with an MP3 fallback for
  older Safari. Video: MP4 (H.264) or AV1.
- Keep individual files small and prefer sprite atlases for many small icons.
- Do not put secrets, personal data, or content with incompatible licensing in
  asset metadata.

## Client configuration

- `VITE_ASSET_BASE_URL` points at the CDN origin (see `apps/web/.env.example`).
- In deployment it is set to the R2 public domain. Locally it can point at a
  local static server or a development R2 prefix.
- A future `GET /v1/assets/manifest` endpoint can serve the manifest from the
  API so the client has one source of truth; until then the manifest is fetched
  directly from the CDN.

## Not used for

- question content JSON (that is `content/`),
- raw learning telemetry, Parquet training data, or model artifacts (separate R2
  buckets and prefixes; see `docs/03-data-storage.md`).
