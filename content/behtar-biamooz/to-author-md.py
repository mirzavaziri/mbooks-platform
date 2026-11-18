#!/usr/bin/env python3
"""Rewrites «بهتر بیاموز!» from its blockquote markup into the ":::"
author-guide markup that api/src/convert-author-md.ts reads.

    python3 to-author-md.py behtar-biamooz-mbooks.md > behtar-biamooz.author.md

Source conventions (see the comment at the top of the source file):
  # book title (front matter until the first ##)   ## workshop = chapter
  ### numbered section    #### subheading
  > **[KIND · tag · tag]** {#label} first line ...   (block in a blockquote)
  **[کد · پایتون · قابل‌اجرا]** intro sentence, then a ```python fence
  a trailing «## واژه‌نامه» pipe table: term | definition | link
Chapters with no ### sections (مقدمه, سخن پایانی) get one unnumbered
section of the same name; the publish renderer hides a section heading
that just repeats its chapter's.
"""
import re
import sys

src = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n')
lines = src.split('\n')
out = []
notes = []  # (chapter/section marker index, note) - emitted as section notes

KIND = {
    'تعریف': 'تعریف', 'قضیه': 'قضیه', 'لم': 'لم', 'گزاره': 'گزاره', 'نتیجه': 'نتیجه',
    'مثال': 'مثال', 'یادداشت': 'یادداشت', 'اصل': 'اصل', 'اثبات': 'اثبات',
    'تمرین': 'تمرین', 'آزمایشگاه': 'آزمایشگاه', 'شکل': 'شکل',
    'حاشیه · معرفی شخص': 'حاشیه-شخص', 'حاشیه · نکته‌ی تاریخی': 'حاشیه-تاریخی',
    'حاشیه · نقل‌قول': 'حاشیه-نقل‌قول', 'حاشیه · آزاد': 'حاشیه-آزاد',
    'جعبه · رشته‌ی پژوهشی': 'جعبه-پژوهشی', 'جعبه · کار خودمان': 'جعبه-کار-خودمان',
    'جعبه · مسیر اثبات': 'جعبه-مسیر-اثبات',
}
# Labs carry no {#label} in the source; give each one so a hand-built
# widget can be matched to it (labs/<label>.html).
LAB_LABELS = {
    'بازی سنگریزه‌ها در برابر رایانه': 'lab-pebbles',
    'حدس عدد': 'lab-guess-number',
    'پرتاب دو تاس': 'lab-dice',
}
ENV = {'تعریف', 'قضیه', 'لم', 'گزاره', 'نتیجه', 'مثال', 'یادداشت', 'اصل'}


def strip_br(s):
    # markdown hard line break "text\" -> plain text
    return re.sub(r'\\$', '', s)


def emit_block(head, body):
    """head: text after '> ' on the first line; body: the remaining quote
    lines with their '> ' removed (blank lines kept)."""
    m = re.match(r'\*\*\[([^\]]+)\]\*\*\s*(.*)$', head)
    if not m:
        out.extend(['> ' + head] + ['> ' + b for b in body])
        return
    tag_text, rest = m.group(1).strip(), m.group(2).strip()
    parts = [p.strip() for p in tag_text.split('·')]
    if parts[0] == 'تمرین':
        kind, ex_tags = 'تمرین', parts[1:]
    else:
        kind, ex_tags = KIND.get(tag_text), []
        if kind is None:
            sys.stderr.write(f'unknown block kind [{tag_text}]\n')
            kind = 'یادداشت'

    label = ''
    lm = re.match(r'\{#([A-Za-z0-9_-]+)\}\s*(.*)$', rest)
    if lm:
        label, rest = lm.group(1), lm.group(2).strip()

    text = [rest] + body
    title = ''
    open_line = f'::: {kind}'

    if kind in ENV:
        # "**Title.** body..." at the very start -> block title
        tm = re.match(r'\*\*(.+?)\.\*\*\s*(.*)$', text[0])
        if tm:
            title, text[0] = tm.group(1).strip(), tm.group(2)
    elif kind == 'حاشیه-شخص':
        pm = re.match(r'(.+?)\s*\(([^)]*)\)\s*$', text[0])
        name, years = (pm.group(1), pm.group(2)) if pm else (text[0], '')
        text = [f'نام: {name}'] + ([f'سال‌ها: {years}'] if years else []) + [t for t in text[1:] if t.strip()]
    elif kind == 'حاشیه-نقل‌قول':
        q, by = [], ''
        for t in text:
            if t.strip().startswith('—'):
                by = t.strip().lstrip('—').strip()
            elif t.strip():
                q.append(t)
        author, _, source = by.partition('،')
        text = q + [f'گوینده: {author.strip()}'] + ([f'منبع: {source.strip()}'] if source.strip() else [])
    elif kind in ('جعبه-پژوهشی', 'جعبه-کار-خودمان', 'آزمایشگاه'):
        title, text = text[0].strip(), text[1:]
        if kind == 'آزمایشگاه' and not label:
            label = LAB_LABELS.get(title, '')
    elif kind == 'شکل':
        fm = re.match(r'`([^`]+)`\s*·\s*(.*)$', text[0])
        if fm:
            text = [f'پرونده: {fm.group(1)}', fm.group(2)] + text[1:]
    elif kind == 'حاشیه-آزاد':
        new = []
        for t in text:
            mm = re.match(r'\*\*(چرا؟|بیشتر بدانید\.?)\*\*\s*(.*)$', t.strip())
            if mm:
                new += [f'--- {mm.group(1).rstrip(".")}', mm.group(2)]
            else:
                new.append(t)
        text = new
    elif kind == 'تمرین':
        new = []
        for t in text:
            s = t.strip()
            hm = re.match(r'\*\*راهنمایی\s*([0-9۰-۹]+)\.\*\*\s*(.*)$', s)
            sm = re.match(r'\*\*پاسخ تشریحی\.\*\*\s*(.*)$', s)
            am = re.match(r'\*\*جواب عددی:\*\*\s*([^·]+?)\s*(?:·\s*\*\*کادر ورودی:\*\*\s*«(.*)»)?\s*$', s)
            if hm:
                new += [f'--- راهنمایی {hm.group(1)}', hm.group(2)]
            elif sm:
                new += ['--- پاسخ', sm.group(1)]
            elif am:
                new.append(f'--- جواب عددی: {am.group(1)}' + (f' | کادر: «{am.group(2)}»' if am.group(2) else ''))
            else:
                new.append(t)
        text = new

    if label:
        open_line += f' #{label}'
    if title:
        open_line += f' «{title}»'
    if ex_tags:
        open_line += ' [' + '، '.join(ex_tags) + ']'
    # trim leading/trailing blank lines
    while text and not text[0].strip():
        text.pop(0)
    while text and not text[-1].strip():
        text.pop()
    out.extend(['', open_line] + text + [':::', ''])


i = 0
chapter_has_section = True
in_front = False
pending_note = None
while i < len(lines):
    line = lines[i]
    s = line.strip()

    # reconstruction notes -> a per-section note for the studio ("Notes
    # between the authors"); placeholders stay visible in the text.
    cm = re.match(r'<!--\s*(.*?)\s*-->$', s)
    if cm and ('بازسازی' in cm.group(1) or 'فایل اصلی نبود' in cm.group(1)):
        out.append(f'<!-- یادداشت-بخش: {cm.group(1)} -->')
        i += 1
        continue

    if s.startswith('```'):
        j = i + 1
        while j < len(lines) and not lines[j].strip().startswith('```'):
            j += 1
        out.extend(lines[i:j + 1])
        i = j + 1
        continue

    if s.startswith('# ') and not s.startswith('## '):
        in_front = True  # title page: settings carry it instead
        i += 1
        continue
    if s.startswith('## '):
        in_front = False
        title = s[3:].strip()
        out.append(f'# {title}')
        # does this chapter have its own numbered sections?
        j = i + 1
        has = False
        while j < len(lines) and not lines[j].startswith('## '):
            if lines[j].startswith('### '):
                has = True
                break
            j += 1
        if not has and title != 'واژه‌نامه':
            out.append(f'## {title}')
        i += 1
        continue
    if in_front:
        i += 1
        continue
    if s.startswith('#### '):
        out.append('### ' + s[5:].strip())
        i += 1
        continue
    if s.startswith('### '):
        out.append('## ' + s[4:].strip())
        i += 1
        continue

    # glossary table -> "- **term**: def — url"
    if s.startswith('|') and '# واژه‌نامه' in out:
        cells = [c.strip() for c in s.strip('|').split('|')]
        if len(cells) >= 2 and cells[0] not in ('اصطلاح',) and not set(cells[0]) <= set('-: '):
            url = cells[2] if len(cells) > 2 and cells[2] else ''
            out.append(f'- **{cells[0]}**: {cells[1]}' + (f' — {url}' if url else ''))
        i += 1
        continue

    km = re.match(r'\*\*\[کد · ([^\]]+)\]\*\*\s*(.*)$', s)
    if km:
        tags = [p.strip() for p in km.group(1).split('·')]
        runnable = 'قابل‌اجرا' in tags
        if km.group(2):
            out.extend(['', km.group(2), ''])
        j = i + 1
        while j < len(lines) and not lines[j].strip().startswith('```'):
            j += 1
        k = j + 1
        while k < len(lines) and not lines[k].strip().startswith('```'):
            k += 1
        out.extend(['::: کد' + (' قابل‌اجرا' if runnable else '')] + lines[j:k + 1] + [':::', ''])
        i = k + 1
        continue

    if s.startswith('> ') or s == '>':
        head = s[2:] if s.startswith('> ') else ''
        body = []
        j = i + 1
        while j < len(lines) and (lines[j].startswith('>')):
            body.append(re.sub(r'^>\s?', '', lines[j]))
            j += 1
        emit_block(head, body)
        i = j
        continue

    # bullet items separated by blank lines -> one list
    if re.match(r'^-\s+', s):
        item = re.sub(r'^-\s+', '- ', s)
        out.append(item)
        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        if j < len(lines) and re.match(r'^-\s+', lines[j].strip()):
            i = j
            continue
        i += 1
        continue

    out.append(strip_br(line))
    i += 1

text = '\n'.join(out)
text = re.sub(r'\n{3,}', '\n\n', text)
print(text)
