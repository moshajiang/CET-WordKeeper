// 抽样扫描近年四级 PDF：是否有文本层、正文是否可用
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = 'D:/2026-10-09-16-27-21/cet-wordkeeper';
const OUT = path.join(ROOT, 'data', 'raw', 'pdf');
fs.mkdirSync(OUT, { recursive: true });
const PY = 'C:/Users/35695/.workbuddy/binaries/python/envs/default/Scripts/python.exe';

const rels = [
  '四级真题/2020.12/真题PDF/cet4_2020_12_1.pdf',
  '四级真题/2021.12/真题PDF/cet4_2021_12_1.pdf',
  '四级真题/2022.12/真题PDF/cet4_2022_12_1.pdf',
  '四级真题/2023.06/真题PDF/2023年6月第1套英语四级真题.pdf',
  '四级真题/2024.12/真题PDF/cet4_2024_12_1.pdf',
  '四级真题/2023.03/真题PDF/cet4_2023_03_1.pdf',
];

// 坏词表：正常四级正文里几乎不会出现的形态，用来粗判 OCR 噪声
const NOISE = /\b(?:fbr|bom|samea|tbe|thc|suder|tsk|hav|wit h|a nd|t he)\b/gi;

for (const rel of rels) {
  const url = 'https://raw.githubusercontent.com/0609x/CET46-Resources/main/' + encodeURI(rel);
  const local = path.join(OUT, path.basename(rel).replace(/\s+/g, '_'));
  try {
    if (!fs.existsSync(local) || fs.statSync(local).size < 5000) {
      const r = await fetch(url);
      if (!r.ok) { console.log(`✗ ${path.basename(rel)} 下载失败 HTTP ${r.status}`); continue; }
      fs.writeFileSync(local, Buffer.from(await r.arrayBuffer()));
    }
    const txt = local + '.txt';
    execFileSync(PY, [path.join(ROOT, 'scripts', 'pdf-extract.py'), local, txt], { encoding: 'utf8' });
    const text = fs.readFileSync(txt, 'utf8');
    const noise = (text.match(NOISE) || []).length;
    const size = (fs.statSync(local).size / 1024 / 1024).toFixed(1);
    const hasRead = /Part\s*[IVXⅠⅡⅢⅣⅤ]+\s*Reading/i.test(text);
    const hasSecC = /Section\s*C/i.test(text);
    console.log(
      `${text.length >= 8000 ? '✓' : '✗'} ${path.basename(rel).slice(0, 34).padEnd(36)} ` +
      `${size}MB  文本${String(text.length).padStart(6)}  噪声${String(noise).padStart(3)}  ` +
      `阅读结构:${hasRead ? '有' : '无'}/SectionC:${hasSecC ? '有' : '无'}`
    );
  } catch (e) {
    console.log(`✗ ${path.basename(rel)} 出错 ${e.message}`);
  }
}
