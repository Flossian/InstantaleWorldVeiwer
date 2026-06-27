// main.js — UI 結線（ワンクリック版）。ファイルをドロップ/選択した時点で自動復号→表示。
import { Viewer } from './view.js';
import { parseWorld } from './parser.js';
import { decodeSave, loadKeyblob } from './codec.js';

const viewer = new Viewer(document);

const loader = document.getElementById('loader');
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const statusEl = document.getElementById('status');

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

// セーブを受け取ったら即座に復号→解析→表示。
async function handleFile(file) {
  if (!file) return;
  setStatus('読み込み中… ' + file.name);
  try {
    const keyblob = await loadKeyblob();
    const json = await decodeSave(file, keyblob);
    const data = parseWorld(JSON.parse(json));
    viewer.load(data);
    loader.classList.add('off');
    setStatus('');
  } catch (err) {
    setStatus(err.message || String(err), 'err');
  }
}

// クリックで選択 / ドラッグ&ドロップ。どちらも選んだ瞬間に表示する。
drop.onclick = () => fileInput.click();
fileInput.onchange = () => handleFile(fileInput.files[0]);
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

document.getElementById('reopen').onclick = () => { loader.classList.remove('off'); };
