# Asset preparation — 2026-10-05

## Ready for the application

- 65 complete paintings at `public/cards/card_001.jpg` through `card_065.jpg`, 900 × 1200 pixels, approximately 26 MB total. Thumbnails are `thumb_001.jpg` through `thumb_065.jpg`, 300 × 400 pixels. All preserve the full painting with no cropping or redrawing.
- 8 original audio excerpts at `public/audio/`: G02_A, G03_A, G03_C, G06_B, G07_B, G07_C, G09_A, G09_C. Their current source pages state an explicit CC0/CC BY/CC BY-SA license or an author public-domain dedication. Include the attribution information in the app; it is also at `public/audio/ATTRIBUTION.txt`.
- `lib/catalog.json` preserves all 30 titles, original 10 groups, original expected filenames, durations, SHA-256 values, and rights notes. It also proposes 3 separate all-online quick-test groups. No original group has all 3 excerpts approved for bundling.
- `docs/asset-audit.json` has the per-recording decision and evidence.
- The original 30 excerpts are preserved outside the app tree, at `../jukebox_inputs/audio_private/`. Restricted bytes are not in the deployable project.

## The 22 held recordings

These are held from the **public website bundle**, not a claim that every conceivable private use is prohibited.

1. **15 YourClassical downloads:** G01_A, G02_C, G03_B, G04_A, G04_B, G05_A, G05_B, G05_C, G07_A, G08_A, G08_B, G09_B, G10_A, G10_B, G10_C. The project source notes record personal-listening downloads, with no game redistribution license. The Clair de lune source was reopened and confirms a downloadable modern Naxos recording, without an open redistribution grant. Noncommercial testing alone does not supply an explicit hosting license.
2. **2 other publicly listenable modern recordings:** G01_C (Carnegie Hall educational recording, permission given to that educational project) and G02_B (Marco Tezza artist-site stream). No explicit license for this website to redistribute the edited excerpts is recorded.
3. **3 historical recordings with regional public-domain labels:** G01_B (Helsinki archive, 1953-era Capitol transfer), G04_C (Karajan 1960, EU expiration template), G06_A (1945 Decca transfer, missing US public-domain tag). Their source labels may support use in some jurisdictions, but do not establish a global grant for an unrestricted hosted site. They need a destination/jurisdiction decision or a clearer replacement, not automatically an artist permission request.
4. **1 archive uploader claim:** G06_C, Ricci Paganini Caprice 24. The archive collection says Public Domain Classic; embedded metadata refers to Japan. Recording date and worldwide rights are not independently established.
5. **1 CC BY-NC-ND excerpt:** G08_C, James Kibbie BWV 565. The source's noncommercial grant covers its no-derivatives condition; the current 40-second excerpt has trimming, gain, and fades. Whether that particular treatment qualifies as a permitted unmodified part is not established. It can be replaced by an explicitly remix-permitted recording or reviewed separately. It is not rejected merely because the license is noncommercial.

## Local import behavior

For unhosted tracks the app may accept a file selected from each player's own device. Keep those bytes local to the browser, do not relay them through the server. Matching filename and SHA-256 against the original excerpt is useful for ensuring that different players hear the same clip; an explicit custom-file mode can relax this separately. Imported files are not evidence of a license for server distribution.

## Card-source recovery

The Library copy of the individual-card ZIP is truncated at card 035. The first 34 JPEG entries were recovered with CRC checks, but none of those is used for final web art. The complete 8-page A4 PDF has all 65 original 1086 × 1448 images. These were extracted by their placement in reading order and converted to JPEG/thumbnail sizes. The 65-image contact sheet was visually checked; each card is unique and matches its original sequential number.

## Credit requirements

Display the title, performer, source link, license link, and modification note for each included clip in an accessible credits view. The ShareAlike excerpts continue under their stated license. Keep the raw audio directly accessible without adding license restrictions. Musopen should be credited with a URL for G02_A. G06_B includes the original TMO YouTube source in its metadata. None of the credit text should be shown as a hint during a round.
