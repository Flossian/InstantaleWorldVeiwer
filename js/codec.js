// codec.js — セーブ復号（C# Common.cs 準拠）。ワンクリック表示版（パスフレーズ不要）。
//
// Common.cs の実装（確定）:
//   - 難読化はアーカイブ無し。ファイル全体に対する「繰り返し XOR」のみ。
//       out[i] = data[i] ^ S[i % S.Length]
//   - S = "Instantale_Save_Key_2026"（24バイト＝周期24）
//   - 先頭が（BOM除去後）'{' / '[' なら平文 JSON とみなしそのまま解釈、失敗時のみ XOR 復号。
//
// 鍵の扱い:
//   平文鍵リテラルをリポに直接置かないため、assets/keyblob.json には
//   「鍵 XOR SHA-256(APP_UNLOCK)」だけを入れる（grep で鍵文字列が出ない）。
//   APP_UNLOCK は秘密ではなく難読化用の固定値。利用者は何も入力しない。
//   ※ これは「鍵を見えにくくする」だけで、強いセキュリティではありません
//     （ゲーム本体に同じ鍵が含まれており、復号手順の公開は承諾済み）。

const APP_UNLOCK = 'instantale-world-viewer/public-unlock/2026';

// ---- base64 ----
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let _xorKeyCache = null;

// keyblob.json を取得。
export async function loadKeyblob(url = './assets/keyblob.json') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('keyblob.json を読み込めません');
  return res.json();
}

// keyblob（鍵 XOR SHA-256(APP_UNLOCK)）→ XOR 鍵（Uint8Array）。メモリ上のみ・キャッシュ。
export async function getXorKey(keyblob) {
  if (_xorKeyCache) return _xorKeyCache;
  if (!keyblob || !keyblob.key) throw new Error('keyblob.json の形式が不正です');
  const masked = b64ToBytes(keyblob.key);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(APP_UNLOCK));
  const mask = new Uint8Array(digest);
  const key = new Uint8Array(masked.length);
  for (let i = 0; i < masked.length; i++) key[i] = masked[i] ^ mask[i];
  _xorKeyCache = key;
  return key;
}

// 繰り返し XOR（Common.cs Transform と同一）。
export function repeatingXor(bytes, key) {
  const out = new Uint8Array(bytes.length);
  const klen = key.length || 1;
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key[i % klen];
  return out;
}

// BOM除去後の先頭非空白が '{' / '[' なら平文 JSON とみなす（Common.cs LooksLikePlainJson 相当）。
function looksLikePlainJson(bytes) {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) i = 3;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0d || bytes[i] === 0x0a)) i++;
  return i < bytes.length && (bytes[i] === 0x7b /*{*/ || bytes[i] === 0x5b /*[*/);
}

// セーブ復号。戻り値は JSON 文字列（パスフレーズ不要・自動判定）。
// 平文 JSON ならそのまま、難読化なら鍵を自動取得して XOR 復号（Common.cs Load 準拠）。
export async function decodeSave(file, keyblob) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (looksLikePlainJson(bytes)) {
    const text = new TextDecoder('utf-8').decode(bytes);
    try { JSON.parse(text); return text; }
    catch { /* 平文解釈に失敗 → 難読化として扱う */ }
  }

  const xorKey = await getXorKey(keyblob);
  const text = new TextDecoder('utf-8').decode(repeatingXor(bytes, xorKey));
  try { JSON.parse(text); }
  catch { throw new Error('このファイルは Instantale のセーブとして復号できませんでした。'); }
  return text;
}
