# English release handoff

## Current status

The requested release makes the first visit to JT Games, Jukebox (including
table playback), and Sushi English, and changes the Jukebox PnP download to
`/pnp/Jukebox_PnP_EN.pdf`. An explicit Chinese choice should remain available
where the site already has a language switch.

At the source audit on 22 October 2026, the production main app was ahead of
`jtstandsforjiangtian/jtgames-site` main (`f049272e9294f435ca17b82e02d1a547d4e4850c`).
Production contains `LanguageProvider`, `useI18n`, the Improviser game, and PnP
download links. This GitHub revision contains none of them. **Do not deploy
this old main revision over production.** First sync the current production
source from the existing development checkout to GitHub, then apply the small
changes below to that current source. Do not add a second language provider.

Sushi is maintained separately in `jtstandsforjiangtian/sushi-auto-demo`.
Its `dist/app.js` and `dist/index.html` on current main were checked against
production and matched apart from a final newline. Its English change can be
reviewed and deployed independently.

The English Sushi change is [pull request #1](https://github.com/jtstandsforjiangtian/sushi-auto-demo/pull/1),
commit `71def685ad33f57fd79f0f5d280ee2acbc78c757`. It updates six files; all 32
simulation/audio tests and JavaScript syntax checks pass. Browser visual QA
is still pending because this environment lacked Chromium and its installation
downloads were truncated. The PR is not a production deployment.

These notes and the verifier are preparation, not evidence of a live release.

## Main app: exact language behavior to change

Find the existing provider in the current source:

```sh
rg -n 'jt-lang|LanguageProvider|useI18n' app src components
```

The production bundle currently implements these four defaults:

| Location | Current behavior | Required behavior |
| --- | --- | --- |
| Context fallback | `lang: "zh"`, Chinese messages | `lang: "en"`, English messages |
| Stored preference initialization | stored `"en"` means English; everything else means Chinese | stored `"zh"` means Chinese; everything else means English |
| State while preference is being read | `lang ?? "zh"` | `lang ?? "en"` |
| Root HTML | `<html lang="zh-CN">` | `<html lang="en">` |

Keep the existing `jt-lang` key. Read local storage in the existing client
effect, and catch failures so restricted storage does not break the page:

```ts
useEffect(() => {
  let preferred: "en" | "zh" = "en";
  try {
    preferred = localStorage.getItem("jt-lang") === "zh" ? "zh" : "en";
  } catch {
    // The English default also works when storage is unavailable.
  }
  setLang(preferred);
}, []);
```

Use the existing setter's actual name. Keep a nullable initial state and gate
the existing write-to-storage effect until that state is resolved; otherwise
an initial English state can overwrite a saved Chinese preference before it
has been read. Use English messages for the nullable server/client fallback,
so a first visit does not flash Chinese. Keep the existing effect that updates
`document.documentElement.lang` on a deliberate language switch.

Do not introduce navigator/browser-language detection. A browser set to
Chinese must still receive English on a first visit. Existing stored `zh`
preferences stay Chinese; older site versions also wrote their default to
this key, so those saved values cannot be distinguished from an explicit
choice. Changing the requested default does not require discarding preferences.

Translate the default `metadata` in `app/layout.tsx` and
`app/jukebox/layout.tsx` (and any newer route-specific metadata). Suggested
copy consistent with the current site:

```ts
// Main layout
title: "JT Games",
description: "Small browser games by JT: Jukebox and the Sushi Shop demo.",

// Jukebox layout
title: "Jukebox — Music, Art & Imagination",
description: "Listen to short music clips, choose an illustration, and discover what your friends heard.",
```

The Chinese dictionary and the existing language switch remain in place.
Inspect all route entry points, not only the home screen: online room creation,
room joining, the Improviser game, rules, music library, art gallery, and
`/jukebox/?play=table` share the provider and must use its English default.

## English PnP asset and links

Place the approved English PDF at:

```text
public/pnp/Jukebox_PnP_EN.pdf
```

Production currently has two download locations (the Jukebox home action and
the rules/help view). Replace every source occurrence of:

```diff
-href="/pnp/jukebox-pnp-a4.pdf"
-download="Jukebox_PnP_A4.pdf"
+href="/pnp/Jukebox_PnP_EN.pdf"
+download="Jukebox_PnP_EN.pdf"
```

The actual source may use object values rather than JSX literals. Search both
forms and update the shared constant if one exists:

```sh
rg -n 'jukebox-pnp-a4|Jukebox_PnP_A4|\.pdf' app src components public
```

Use the new English file from both language views, as requested. Keep an old
PDF file if existing external links may depend on it; it should no longer be
the primary download. Preserve the live online game's skill quantities and
game logic. The printable edition's six skill cards are a separate packaging
choice, not an instruction to reduce the online pool.

The current English in-game terms are `Improviser`, `Listener`, `Spotlight`,
`Curtain`, `Hushed`, `Opera glass`, `Mended ticket`, and `Quiet seat`.

## Validation before deployment

Run the current repository's checks and production build using its existing
package manager. At this audit its scripts use pnpm and Node 22:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Use the actual current scripts if they differ after the source sync. In a
browser, verify these cases on `/`, `/jukebox/`, `/jukebox/?play=table`, and
`/sushi/`:

1. Fresh storage and a Chinese browser language: English immediately, including
   the initial render, page title, menus, and help text.
2. Saved `jt-lang=en`: English after reload and navigation.
3. Saved `jt-lang=zh`: the existing bilingual main app stays Chinese after
   reload, and its switch can return to English. Sushi has no existing switch;
   its translated standalone demo stays English.
4. Invalid or unavailable local storage: English without a client error.
5. Jukebox's PnP button and help download both return the approved English PDF.
6. Table playback can play, replay, and choose the next random short track;
   create/join/play/leave still work in the online game.

The supplied verifier checks initial HTML, page titles, links, the PDF header,
and optionally the exact PDF bytes. It cannot replace the client checks above:

```sh
python3 scripts/verify-english-release.py \
  --base http://localhost:3000 \
  --pdf public/pnp/Jukebox_PnP_EN.pdf
```

For local Next-only development, `/sushi/` needs the same static mount as
production; otherwise run the full verifier against the deployed domain.

## Deployment using the existing server

Production is the existing Tencent Ubuntu/Caddy installation, not a Sites
preview. The established commands run from the **current, updated** main
app checkout on the owner's Mac, where the deployment key already resides:

```sh
cd /Users/jt/Projects/jukebox
JUKEBOX_SSH_KEY="$HOME/.ssh/jukebox_deploy.pem" \
  ./deploy/publish.sh ubuntu@124.156.136.248 update
```

Deploy the reviewed Sushi commit separately; use its exact commit SHA rather
than an unrelated branch tip:

```sh
JUKEBOX_SSH_KEY="$HOME/.ssh/jukebox_deploy.pem" \
  ./deploy/publish-sushi.sh ubuntu@124.156.136.248 71def685ad33f57fd79f0f5d280ee2acbc78c757
```

If the Sushi PR receives further edits, substitute its reviewed final commit.
These are the existing deployment scripts; no hosting
migration or new domain is needed. Do not upload private keys to GitHub or the
website. This execution environment did not contain the Mac deployment key.

After deployment:

```sh
python3 scripts/verify-english-release.py \
  --pdf public/pnp/Jukebox_PnP_EN.pdf
```

Complete the browser checks above. Do not describe the site as updated until
both the public checks and the user-facing client behavior have passed.
