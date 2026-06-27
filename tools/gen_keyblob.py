#!/usr/bin/env python3
# assets/keyblob.json を生成する（依存ライブラリ不要・標準ライブラリのみ）。
#
# 仕組み: keyblob には「鍵 XOR SHA-256(APP_UNLOCK)」だけを base64 で入れる。
#   → リポを grep しても平文の鍵文字列は出てこない。
#   APP_UNLOCK は js/codec.js の APP_UNLOCK と必ず一致させること（秘密ではなく難読化用）。
#
# 使い方:  python tools/gen_keyblob.py
import hashlib, base64, json, os

# js/codec.js の APP_UNLOCK と一致させる
APP_UNLOCK = b'instantale-world-viewer/public-unlock/2026'
# ゲームの XOR 鍵（Common.cs の S）。リポには直接置かず、ここでのみ使う。
KEY = b'Instantale_Save_Key_2026'

mask = hashlib.sha256(APP_UNLOCK).digest()
masked = bytes(KEY[i] ^ mask[i] for i in range(len(KEY)))
blob = {
    "_note": "鍵 XOR SHA-256(APP_UNLOCK)。平文鍵リテラルは含まない。",
    "v": 1,
    "key": base64.b64encode(masked).decode(),
}
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'keyblob.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(blob, f, ensure_ascii=False)
print("wrote", os.path.normpath(out))
