#!/usr/bin/env python3
"""Rewrites «معماهای یک‌رقمی» from its bracket-label markup into the ":::"
author-guide markup that api/src/convert-author-md.ts reads.

    python3 to-author-md.py single-digit-puzzles-fa.md > single-digit-puzzles.author.md

Source conventions (from the uploader note at the top of the source file):
  # book title   ## chapter   ### section (one puzzle per section)
  a block starts with a bracketed label line and runs until the next one:
  [متن]  [تمرین]  [حاشیه: نکته‌ی تاریخی]  [حاشیه: معرفی شخص]  [حاشیه: آزاد]
  [کد: قابل‌اجرا]  [یادداشت]
  inside [تمرین]: «برچسب:» «نوع:» «متن:» «راهنمایی N:» «پاسخ تشریحی:»
  «جواب عددی:» «برچسب کادر:»; a field may continue over several lines.
"""
import re
import sys

lines = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n').split('\n')

# drop the uploader note
if lines and lines[0].startswith('[یادداشت برای بارگذاری‌کننده'):
    end = next(i for i, l in enumerate(lines) if l.strip() == '[پایان یادداشت]')
    lines = lines[end + 1:]

LABEL = re.compile(r'^\[([^\]]+)\]\s*$')
FIELD = re.compile(r'^(برچسب کادر|برچسب|نوع|متن|راهنمایی\s*[0-9۰-۹]+|پاسخ تشریحی|جواب عددی)\s*:\s*(.*)$')
out = []


def is_boundary(l):
    s = l.strip()
    return bool(LABEL.match(s)) or s.startswith('#')


def emit_exercise(body):
    fields, order, cur = {}, [], None
    in_fence = False
    for l in body:
        if l.strip().startswith('```'):
            in_fence = not in_fence
        m = None if in_fence else FIELD.match(l.strip())
        if m:
            cur = re.sub(r'\s+', ' ', m.group(1))
            fields[cur] = [m.group(2)]
            order.append(cur)
        elif cur is not None:
            fields[cur].append(l)
        elif l.strip():
            sys.stderr.write(f'exercise text before any field: {l[:60]}\n')

    def val(k):
        return '\n'.join(fields.get(k, [])).strip()

    head = '::: تمرین'
    if val('برچسب'):
        head += ' #' + val('برچسب')
    if val('نوع'):
        head += ' [' + val('نوع') + ']'
    out.extend(['', head, val('متن')])
    hints = [k for k in order if k.startswith('راهنمایی')]
    for k in hints:
        out.extend([f'--- {k}', val(k)])
    if 'پاسخ تشریحی' in fields:
        out.extend(['--- پاسخ', val('پاسخ تشریحی')])
    if 'جواب عددی' in fields:
        line = f'--- جواب عددی: {val("جواب عددی")}'
        if val('برچسب کادر'):
            line += f' | کادر: «{val("برچسب کادر")}»'
        out.append(line)
    out.extend([':::', ''])


KIND = {
    'حاشیه: نکته‌ی تاریخی': 'حاشیه-تاریخی',
    'حاشیه: معرفی شخص': 'حاشیه-شخص',
    'حاشیه: آزاد': 'حاشیه-آزاد',
    'یادداشت': 'یادداشت',
}

i = 0
while i < len(lines):
    s = lines[i].strip()
    if s.startswith('### '):
        out.append('## ' + s[4:].strip())
        i += 1
        continue
    if s.startswith('## '):
        out.append('# ' + s[3:].strip())
        i += 1
        continue
    if s.startswith('# '):
        # book title (and the «نویسنده:» line under it) go to book settings
        i += 1
        while i < len(lines) and (not lines[i].strip() or lines[i].startswith('نویسنده:')):
            i += 1
        continue

    m = LABEL.match(s)
    if not m:
        out.append(lines[i])
        i += 1
        continue

    label = m.group(1).strip()
    j = i + 1
    in_fence = False
    body = []
    while j < len(lines):
        if lines[j].strip().startswith('```'):
            in_fence = not in_fence
        if not in_fence and is_boundary(lines[j]):
            break
        body.append(lines[j])
        j += 1
    while body and not body[-1].strip():
        body.pop()

    if label == 'متن':
        out.extend([''] + body + [''])
    elif label == 'تمرین':
        emit_exercise(body)
    elif label.startswith('کد'):
        runnable = 'قابل‌اجرا' in label
        out.extend(['', '::: کد' + (' قابل‌اجرا' if runnable else '')] + body + [':::', ''])
    elif label in KIND:
        out.extend(['', '::: ' + KIND[label]] + body + [':::', ''])
    else:
        sys.stderr.write(f'unknown block label [{label}], kept as text\n')
        out.extend([''] + body + [''])
    i = j

text = re.sub(r'\n{3,}', '\n\n', '\n'.join(out))
print(text)
