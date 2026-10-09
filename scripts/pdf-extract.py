import sys
from pypdf import PdfReader

src, dst = sys.argv[1], sys.argv[2]
r = PdfReader(src)
parts = []
for p in r.pages:
    try:
        parts.append(p.extract_text() or "")
    except Exception:
        parts.append("")
text = "\n".join(parts)
with open(dst, "w", encoding="utf-8") as f:
    f.write(text)
print(len(text))
