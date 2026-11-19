#!/usr/bin/env python3
"""Rewrites «گره» (GirihBench) into the ":::" author-guide markup that
api/src/convert-author-md.ts reads.

    python3 to-author-md.py GirihBench-mbooks.md > girihbench.author.md

The source already uses "# chapter / ## n.k section / ### subheading" and
"::: kind ... :::" blocks; what differs:
  - exercises are field-based inside their block: «برچسب:» «نوع:», the
    statement, then «**پاسخ تشریحی.**» starting the hidden solution, and
    «جواب عددی:» / «کادر جواب:» lines for the self-check box;
  - block kinds are written «حاشیه: نکته‌ی تاریخی», «جعبه: کار خودمان»
    (first line «عنوان: ...» is the paper), «کد (غیرقابل‌اجرا)» (unfenced);
  - the title/author lines before the first chapter go to book settings;
  - text a chapter has before its first numbered section (and the preface,
    which has none) gets an unnumbered section named like the chapter,
    whose heading the publish step hides;
  - "فصل ۱ — دادگاه دستمال" becomes "فصل ۱: دادگاه دستمال" like the
    other books (no dash as a separator in Persian titles).
"""
import re
import sys

lines = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n')
lines = re.sub(r'<!--[\s\S]*?-->', '', lines).split('\n')
out = []

KIND = {
    'حاشیه: نکته‌ی تاریخی': 'حاشیه-تاریخی',
    'حاشیه: معرفی شخص': 'حاشیه-شخص',
    'حاشیه: آزاد': 'حاشیه-آزاد',
    'حاشیه: نقل‌قول': 'حاشیه-نقل‌قول',
    'جعبه: کار خودمان': 'جعبه-کار-خودمان',
    'جعبه: رشته‌ی پژوهشی': 'جعبه-پژوهشی',
    'جعبه: مسیر اثبات': 'جعبه-مسیر-اثبات',
}


def trim(xs):
    while xs and not xs[0].strip():
        xs.pop(0)
    while xs and not xs[-1].strip():
        xs.pop()
    return xs


def emit_exercise(body):
    label = tags = answer = prompt = ''
    stmt, sol, in_sol = [], [], False
    for l in body:
        s = l.strip()
        m = re.match(r'^(برچسب|نوع|جواب عددی|کادر جواب)\s*:\s*(.*)$', s)
        if m:
            k, v = m.group(1), m.group(2).strip()
            if k == 'برچسب': label = v
            elif k == 'نوع': tags = v
            elif k == 'جواب عددی': answer = v
            else: prompt = v
            continue
        if s == '**پاسخ تشریحی.**':
            in_sol = True
            continue
        (sol if in_sol else stmt).append(l)
    head = '::: تمرین' + (f' #{label}' if label else '') + (f' [{tags}]' if tags else '')
    out.extend(['', head] + trim(stmt))
    if sol:
        out.extend(['--- پاسخ'] + trim(sol))
    if answer:
        out.append(f'--- جواب عددی: {answer}' + (f' | کادر: «{prompt}»' if prompt else ''))
    out.extend([':::', ''])


i = 0
chapter = None
need_intro_section = False
while i < len(lines):
    raw = lines[i]
    s = raw.strip()

    # front matter before the first chapter: title/author go to settings
    if chapter is None and not s.startswith('# '):
        i += 1
        continue

    if s.startswith('# '):
        chapter = s[2:].strip().replace('(بی‌شماره)', '').strip()
        chapter = re.sub(r'\s+—\s+', ': ', chapter)
        out.append('# ' + chapter)
        need_intro_section = True
        i += 1
        continue
    if s.startswith('## '):
        need_intro_section = False
        out.append(raw)
        i += 1
        continue
    if need_intro_section and s:
        # content before the chapter's first section
        out.append('## ' + chapter)
        need_intro_section = False

    if s.startswith('::: '):
        kind = s[4:].strip()
        j = i + 1
        body = []
        while j < len(lines) and lines[j].strip() != ':::':
            body.append(lines[j])
            j += 1
        body = trim(body)
        if kind == 'تمرین':
            emit_exercise(body)
        elif kind.startswith('کد'):
            runnable = 'غیرقابل' not in kind and 'قابل‌اجرا' in kind
            fenced = any(l.strip().startswith('```') for l in body)
            code = body if fenced else ['```text'] + body + ['```']
            out.extend(['', '::: کد' + (' قابل‌اجرا' if runnable else '')] + code + [':::', ''])
        elif kind in KIND:
            k = KIND[kind]
            title = ''
            if body and re.match(r'^عنوان\s*:', body[0].strip()):
                title = re.sub(r'^عنوان\s*:\s*', '', body[0].strip())
                body = trim(body[1:])
            out.extend(['', '::: ' + k + (f' «{title}»' if title else '')] + body + [':::', ''])
        else:
            sys.stderr.write(f'unknown block kind «{kind}» at line {i + 1}; kept as text\n')
            out.extend([''] + body + [''])
        i = j + 1
        continue

    out.append(raw)
    i += 1

print(re.sub(r'\n{3,}', '\n\n', '\n'.join(out)))
