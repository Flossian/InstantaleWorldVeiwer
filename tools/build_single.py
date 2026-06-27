#!/usr/bin/env python3
# 単一HTML（instantale_world_viewer.html）を既存ソースから組み立てる。
# file:// で動くよう fetch / ES Modules / crypto.subtle を使わない形に変換する:
#   - styles.css を <style> に埋め込み
#   - parser.js / layout.js / view.js は import・export を除去して連結
#   - codec は base64 鍵を埋め込む単純版に差し替え（keyblob/crypto 不要）
#   - main を埋め込み（fetch しない）
import os, re, json

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
def read(p): return open(os.path.join(ROOT, p), encoding='utf-8').read()

def strip_module(js):
    out = []
    for line in js.splitlines():
        if re.match(r'\s*import\s', line):      # import 行は丸ごと削除
            continue
        line = re.sub(r'^\s*export\s+', '', line)  # 行頭 export を除去
        out.append(line)
    return '\n'.join(out)

css = read('styles.css')
parser_js = strip_module(read('js/parser.js'))
layout_js = strip_module(read('js/layout.js'))
view_js   = strip_module(read('js/view.js'))

codec_js = r'''
// ---- codec（単一HTML版: base64鍵を埋め込み・crypto/fetch不要） ----
function b64ToBytes(b64){const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
// Common.cs と同じ鍵（base64）。デコードすると "Instantale_Save_Key_2026"。
const XOR_KEY = b64ToBytes('SW5zdGFudGFsZV9TYXZlX0tleV8yMDI2');
function repeatingXor(bytes,key){const out=new Uint8Array(bytes.length);const kl=key.length||1;for(let i=0;i<bytes.length;i++)out[i]=bytes[i]^key[i%kl];return out;}
function looksLikePlainJson(bytes){let i=0;if(bytes.length>=3&&bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF)i=3;while(i<bytes.length&&(bytes[i]===0x20||bytes[i]===0x09||bytes[i]===0x0d||bytes[i]===0x0a))i++;return i<bytes.length&&(bytes[i]===0x7b||bytes[i]===0x5b);}
async function decodeSave(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(looksLikePlainJson(bytes)){const t=new TextDecoder('utf-8').decode(bytes);try{JSON.parse(t);return t;}catch(_){}}
  const t=new TextDecoder('utf-8').decode(repeatingXor(bytes,XOR_KEY));
  try{JSON.parse(t);}catch(_){throw new Error('このファイルは Instantale のセーブとして復号できませんでした。');}
  return t;
}
'''

main_js = r'''
// ---- main（単一HTML版: fetch しない） ----
const viewer=new Viewer(document);
const loader=document.getElementById('loader'),drop=document.getElementById('drop'),fileInput=document.getElementById('file'),statusEl=document.getElementById('status');
function setStatus(m,c){statusEl.textContent=m;statusEl.className='status'+(c?' '+c:'');}
async function handleFile(file){if(!file)return;setStatus('読み込み中… '+file.name);try{const json=await decodeSave(file);const data=parseWorld(JSON.parse(json));viewer.load(data);loader.classList.add('off');setStatus('');}catch(err){setStatus(err.message||String(err),'err');}}
drop.onclick=()=>fileInput.click();
fileInput.onchange=()=>handleFile(fileInput.files[0]);
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>handleFile(e.dataTransfer.files[0]));
document.getElementById('reopen').onclick=()=>loader.classList.remove('off');
'''

script = (
    '(function(){\n"use strict";\n'
    + codec_js + '\n'
    + parser_js + '\n'
    + layout_js + '\n'
    + view_js + '\n'
    + main_js + '\n'
    + '})();\n'
)

# import/export/fetch が残っていないこと
for bad in ['\nimport ', '\nexport ', 'fetch(', 'crypto.subtle']:
    assert bad not in script, 'leftover: ' + repr(bad)

# index.html の <body> マークアップを流用（外部CSS/モジュールscript を除去）
body = re.search(r'<body>(.*)</body>', read('index.html'), re.S).group(1)
body = re.sub(r'\s*<script type="module"[^>]*></script>', '', body)

html = f'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Instantale World Viewer</title>
<style>
{css}
</style>
</head>
<body>{body}
<script>
{script}</script>
</body>
</html>
'''

out = os.path.join(ROOT, 'instantale_world_viewer.html')
open(out, 'w', encoding='utf-8').write(html)
print('wrote', os.path.basename(out), '(', len(html.encode('utf-8')), 'bytes )')
