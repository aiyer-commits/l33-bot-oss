## Third-Party Notices

This repository ships multilingual keyboard and IME support that depends on upstream open-source libraries and dictionary data.

Included runtime libraries:

- `wanakana`
  - Use: Japanese kana conversion and IME helpers in the web keyboard runtime
  - License: MIT
  - License text: [LICENSES/wanakana.MIT.txt](/home/ai/Development/l33-bot-oss/LICENSES/wanakana.MIT.txt)
  - Upstream: https://github.com/WaniKani/WanaKana
- `hangul-js`
  - Use: Korean Hangul composition in the web keyboard runtime
  - License: MIT
  - License text: [LICENSES/hangul-js.MIT.txt](/home/ai/Development/l33-bot-oss/LICENSES/hangul-js.MIT.txt)
  - Upstream: https://github.com/e-/Hangul.js

Included generated IME packs:

- `public/ime/ja-mozc.*.json`
  - Generated from Google Mozc `dictionary_oss`
  - Source license and notices:
    - [LICENSES/mozc.BSD-3-Clause.txt](/home/ai/Development/l33-bot-oss/LICENSES/mozc.BSD-3-Clause.txt)
    - [LICENSES/mozc-dictionary_oss.README.txt](/home/ai/Development/l33-bot-oss/LICENSES/mozc-dictionary_oss.README.txt)
  - Upstream: https://github.com/google/mozc
- `public/ime/zh-rime-ice.*.json`
  - Generated from `rime-ice` dictionaries
  - Source license and notices:
    - [LICENSES/rime-ice.GPL-3.0.txt](/home/ai/Development/l33-bot-oss/LICENSES/rime-ice.GPL-3.0.txt)
    - [LICENSES/rime-ice.README.md](/home/ai/Development/l33-bot-oss/LICENSES/rime-ice.README.md)
  - Upstream: https://github.com/iDvel/rime-ice

Notes:

- The generated IME assets are built by [scripts/build-ime-packs.mjs](/home/ai/Development/l33-bot-oss/scripts/build-ime-packs.mjs).
- The Japanese pack preserves Mozc `dictionary_oss` source notices.
- The Chinese pack is generated from the upstream `rime_ice.dict.yaml` import manifest and the referenced dictionary tables.
