# Bundled terminal font

`0xProto Nerd Font Mono` — the Nerd Fonts **v3.4.0** patch of 0xProto **v2.300**.

- Upstream typeface: <https://github.com/0xType/0xProto>
- Patched release: <https://github.com/ryanoasis/nerd-fonts/releases> (`0xProto.zip`)

## Why these files are in the repo

Elena is offline-only, so the app can never fetch a font at runtime. A clean Windows 11 machine has no Nerd Font
installed, and until this was bundled every powerline separator and devicon an agent CLI emits rendered as tofu.
Naming a font in a CSS stack does not ship it — `DEFAULT_TERMINAL_FONT_STACK` used to lead with `JetBrains Mono`,
which was never distributed either, so the terminal silently fell through to Cascadia Mono.

## Which variant

Only the **Mono (NFM)** faces are here. The plain `NF` variant draws icons at roughly 1.5 cells wide and the `NFP`
variant is proportional; both break the terminal cell grid.

## Faces

| File | weight | style |
| --- | --- | --- |
| `0xProtoNerdFontMono-Regular.ttf` | 400 | normal |
| `0xProtoNerdFontMono-Bold.ttf` | 700 | normal |
| `0xProtoNerdFontMono-Italic.ttf` | 400 | italic |

**Upstream ships no bold-italic face.** CSS font matching narrows by style before weight, so a bold-italic cell
resolves to the 400-italic face and Chromium synthesises the weight. That is expected, not a missing file.

## Licence

SIL Open Font License 1.1, **no Reserved Font Name**. The licence text ships with the app at
`src/renderer/public/OFL-0xProto.txt` → `out/renderer/OFL-0xProto.txt`, which `files: out/**` pulls into the asar.
Do not move it next to these `.ttf` files: assets under `src/` are only emitted when a module imports them, so a
licence parked here would stay in the repo and never reach an installed copy.

The `@font-face` declarations live in `src/renderer/src/styles/fonts.css`.
