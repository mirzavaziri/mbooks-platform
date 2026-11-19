#!/usr/bin/env python3
"""Turns «گره» (a Persian story, fiction-fa) from its Word manuscript into the
author-guide markup that api/src/convert-author-md.ts reads.

    pandoc Gereh.docx -t markdown-bracketed_spans-native_spans-raw_html-link_attributes \
        --wrap=none --extract-media=media -o gereh-source.md
    python3 to-author-md.py gereh-source.md > gereh-mbooks.md

What the manuscript has, and where it goes:
  - front page (title, subtitle, author, dedication) -> book settings and a
    «تقدیم» chapter; the hand-made «فهرست گام‌ها» is dropped (the published
    page builds its own table of contents);
  - «**گام N**» + «**title**[^k]» -> "# گام N: title" with an unnumbered
    section of the same name (its heading is hidden on the published page);
    chapters 8-12 were written as a bare «**۸**», they get «گام» too;
  - the Hafez couplet footnoted on every chapter title -> a «حاشیه-نقل‌قول»
    (گوینده: حافظ) at the top of the chapter; every other footnote -> a
    «حاشیه-آزاد» right after the paragraph that cites it;
  - the teaser that opens each chapter and the quoted notices inside the
    story stay "> " blockquotes;
  - the floating illustrations -> a «شکل» block (no caption, so no number
    and no alt text: they are decorative) just before their paragraph;
  - the cipher table at the end -> a pipe table in its own chapter.
Plain typos are fixed through FIXES below, so the manuscript stays the
author's and every change is listed in one place.
"""
import re
import sys

FA = '۰۱۲۳۴۵۶۷۸۹'

# (old, new, why) - each must match at least once, or the run fails, so a
# fix can never silently stop applying when the source changes.
FIXES = [
    ('شادتر از قبل از نشان می‌داد', 'شادتر از قبل نشان می‌داد', 'یک «از» اضافه'),
    ('پارگراف', 'پاراگراف', 'غلط تایپی (دو جا)'),
    ('خانم چهچه‌زن', 'خانم چهچهه‌زن', 'یکدستی با «چهچهه» در بقیه‌ی کتاب'),
    ('حنجره‌نتی', 'حنجره‌نُتی', 'یکدستی با «حنجره‌نُتی» در بقیه‌ی کتاب'),
    ('پشمیان', 'پشیمان', 'غلط تایپی'),
    ('ابراز عملی', 'ابزار عملی', 'غلط تایپی'),
    ('وجود داشتند: آنها باید بدانند', 'وجود داشت: آنها باید بدانند', 'مطابقت فعل با «یک نکته»'),
    ('مبدأیی', 'مبدئی', 'املا'),
    ('حکفرما', 'حکمفرما', 'غلط تایپی'),
    ('اصلاً نگران نباشد.', 'اصلاً نگران نباشید.', 'غلط تایپی (خطاب به نیما و نگار)'),
    ('هما را روی شانه‌اش گذاش و', 'هما را روی شانه‌اش گذاشت و', 'غلط تایپی'),
    ('آنها را در گره مورد نظر قرار دارند', 'آنها را در گره مورد نظر قرار دادند', 'غلط تایپی'),
    ('نت RE" را تکرار می کردند', 'نت RE" را تکرار می‌کردند', 'نیم‌فاصله'),
    ('کهشکان', 'کهکشان', 'غلط تایپی'),
    ('متاًسفانه', 'متأسفانه', 'غلط تایپی'),
    ('نگاهی از سر تحسین انداخت گفت', 'نگاهی از سر تحسین انداخت و گفت', 'واو جاافتاده'),
    ('با حروف کوچک و علامت ‍\'', 'با حروف کوچک و علامت \'', 'نویسه‌ی نامرئی'),
]


def fa(n):
    return ''.join(FA[int(d)] for d in str(n))


src = open(sys.argv[1], encoding='utf-8').read().replace('\r\n', '\n')

for old, new, _why in FIXES:
    if old not in src:
        sys.exit(f'fix no longer applies: {old!r}')
    src = src.replace(old, new)

src = src.replace('‌‌', '‌')   # doubled ZWNJ

# Note names (SI', do, RE", LA'SI', DO"FA", the whole cipher line) become
# `code`: the published page shows inline code left-to-right and isolated,
# so the trailing ' or " stays put inside Persian text, and the clues stand
# out a little. "Fa" in the manuscript's table is a typo for FA.
NOTE = r"(?:do|re|mi|fa|sol|la|si|DO|RE|MI|FA|SOL|LA|SI)['\"]?"
src = re.sub(rf"(?<![A-Za-z`])((?:{NOTE})+)(?![A-Za-z`])", r'`\1`', src)
src = src.replace('\\...', '...')              # pandoc escapes "..."

# Footnotes: "[^n]: text" (continuation lines indented 4 spaces).
notes = {}
body_lines = []
lines = src.split('\n')
i = 0
while i < len(lines):
    m = re.match(r'^\[\^(\d+)\]:\s?(.*)$', lines[i])
    if m:
        k, text = m.group(1), [m.group(2)]
        i += 1
        while i < len(lines) and (lines[i].startswith('    ') or lines[i] == ''):
            if lines[i].strip():
                text.append(lines[i].strip())
            i += 1
        notes[k] = text
        continue
    body_lines.append(lines[i])
    i += 1

# Paragraphs are separated by blank lines; pandoc writes a few stray
# "\" (hard line break) paragraphs between chapters - drop those.
paras = [p.strip('\n') for p in re.split(r'\n\s*\n', '\n'.join(body_lines))]
paras = [p for p in paras if p.strip() and p.strip() not in ('\\', '**\\\n**')]

out = []
emit = out.append
used_notes = set()


def hafez(k):
    """Footnote k is a couplet on a chapter title: 'm1 / m2' then the source line."""
    used_notes.add(k)
    verse, source = notes[k][0], notes[k][1] if len(notes[k]) > 1 else ''
    source = source.replace('دیوان حافظ، ', '').replace('شماره ', '')
    emit('::: حاشیه-نقل‌قول')
    emit(verse)
    emit('گوینده: حافظ')
    if source:
        emit('منبع: دیوان، ' + source)
    emit(':::')
    emit('')


def free_note(k):
    used_notes.add(k)
    emit('::: حاشیه-آزاد')
    emit(' '.join(notes[k]))
    emit(':::')
    emit('')


fig_count = 0


def take_images(p):
    """Pulls every ![](media/imageN.ext) out of a paragraph, emits a figure block
    for each (in order), and returns the paragraph without them."""
    global fig_count
    for m in re.finditer(r'!\[\]\(media/(image\d+)\.(\w+)\)', p):
        fig_count += 1
        emit('::: شکل')
        emit(f'پرونده: gereh-{int(m.group(1)[5:]):03d}.jpg')
        emit(':::')
        emit('')
    return re.sub(r'!\[\]\(media/image\d+\.\w+\)', '', p).strip()


def paragraph(p):
    p = take_images(p)
    if not p:
        return
    refs = re.findall(r'\[\^(\d+)\]', p)
    p = re.sub(r'\[\^(\d+)\]', '', p)
    emit(p)
    emit('')
    for k in refs:
        free_note(k)


def chapter(title, num=None):
    full = f'گام {fa(num)}: {title}' if num is not None else title
    emit(f'# {full}')
    emit('')
    emit(f'## {full}')
    emit('')


def strip_bold(p):
    return re.sub(r'^\*\*(.*)\*\*$', r'\1', p.strip()).strip()


# --- uploader note -------------------------------------------------------
emit('''<!--
یادداشت برای بارگذاری‌کننده (در کتاب نمایش داده نمی‌شود)
عنوان کتاب: «گره» - زیرعنوان: «ماجرای استخدام نیما و نگار در ۱۱۲٫۵ سال نوری دورتر»
نویسنده: مجید میرزاوزیری (استاد گروه ریاضی محض، دانشگاه فردوسی مشهد)
ویراستار: نبی ... (نام کامل را نویسنده بعداً می‌دهد)
نوع کتاب: fiction-fa - نامک پیشنهادی: gereh
جلد: cover.jpg (همان تصویر صفحه‌ی اول نسخه‌ی Word)
تصویرها: figures/gereh-NNN.jpg (NNN همان شماره‌ی imageNNN در فایل Word است)
================================================================
این فایل را content/gereh/to-author-md.py از gereh-source.md (خروجی pandoc
از Gereh.Mirzavaziri.Final.docx) می‌سازد؛ دستی ویرایش نکنید، اصلاح‌ها را در
آن اسکریپت (FIXES) یا در منبع بدهید.

  # گام N: عنوان        + ## با همان نام (بخش بی‌شماره؛ عنوانش در صفحه پنهان است)
  > ...                  پیش‌فصل (تکه‌ای از خود فصل) و متن‌های نقل‌شده در داستان
  ::: حاشیه-نقل‌قول      بیت حافظ که نام هر گام از آن آمده (در Word پانوشت عنوان بود)
  ::: حاشیه-آزاد         بقیه‌ی پانوشت‌ها، کنار همان بندی که به آن ارجاع می‌داد
  ::: شکل                تصویرهای تزئینی متن، بی‌زیرنویس و بی‌شماره
================================================================
-->
''')

# --- front matter ------------------------------------------------------------
# Everything before «**گام ۰**»: title page and dedication.
idx = next(i for i, p in enumerate(paras) if strip_bold(p) == 'گام ۰')
front = paras[:idx]
dedication = [strip_bold(p) for p in front if 'تقدیم' in p or 'به خاطر گره‌هایی' in p]
chapter('تقدیم')
emit('*به نام گشاینده گره‌ها*')
emit('')
for d in dedication:
    emit(f'**{d}**')
    emit('')

# --- chapters -----------------------------------------------------------------
rest = paras[idx:]
i = 0
in_toc = False
while i < len(rest):
    p = rest[i]
    s = strip_bold(p)

    if s == 'فهرست گام‌ها':
        in_toc = True
        i += 1
        continue
    if in_toc:
        # the manual TOC runs until the next chapter marker
        if re.fullmatch(r'(گام )?[۰-۹]+', s) and i + 1 < len(rest) and '[^' in rest[i + 1]:
            in_toc = False
        else:
            i += 1
            continue

    m = re.fullmatch(r'(?:گام )?([۰-۹]+)', s)
    if m and i + 1 < len(rest):
        num = int(''.join(str(FA.index(c)) for c in m.group(1)))
        tline = rest[i + 1]
        refs = re.findall(r'\[\^(\d+)\]', tline)
        title = strip_bold(re.sub(r'\[\^\d+\]', '', tline))
        chapter(title, num)
        for k in refs:
            hafez(k)
        i += 2
        continue

    if s == 'جدول الفبای نُتی':
        chapter('پیوست: جدول الفبای نُتی')
        emit('هر حرف الفبای فارسی با یک نُت در یکی از پنج اکتاو نوشته می‌شود: اکتاو اول با حروف کوچک (`do`)، اکتاو دوم با حروف کوچک و علامت `\'` (`do\'`)، اکتاو سوم با حروف بزرگ (`DO`)، اکتاو چهارم با حروف بزرگ و علامت `\'` (`DO\'`) و اکتاو پنجم با حروف بزرگ و علامت `"` (`DO"`).')
        emit('')
        names = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si']
        letters = [
            'آ ب پ ت ث ج چ', 'ح خ د ذ ر ز ژ', 'س ش ص ض ط ظ ع',
            'غ ف ق ک گ ل م', 'ن و ه ی',
        ]
        marks = [lambda n: n, lambda n: n + "'", lambda n: n.upper(),
                 lambda n: n.upper() + "'", lambda n: n.upper() + '"']
        ords = ['اول', 'دوم', 'سوم', 'چهارم', 'پنجم']
        emit('| اکتاو | ' + ' | '.join(['اول', 'دوم', 'سوم', 'چهارم', 'پنجم', 'ششم', 'هفتم']) + ' |')
        emit('|' + ' --- |' * 8)
        for o, row in enumerate(letters):
            cells = [f'{ch} `{marks[o](names[c])}`' for c, ch in enumerate(row.split())]
            cells += [''] * (7 - len(cells))
            emit(f'| {ords[o]} | ' + ' | '.join(cells) + ' |')
        emit('')
        break  # the table is the last thing before the footnotes

    if p.startswith('>'):
        p = take_images(p)
        refs = re.findall(r'\[\^(\d+)\]', p)
        emit(re.sub(r'\[\^(\d+)\]', '', p))
        emit('')
        for k in refs:
            free_note(k)
        i += 1
        continue

    paragraph(p)
    i += 1

missing = set(notes) - used_notes
if missing:
    sys.exit(f'footnotes never placed: {sorted(missing, key=int)}')

text = '\n'.join(out)
text = re.sub(r'\n{3,}', '\n\n', text).strip() + '\n'
sys.stdout.write(text)
print(f'{fig_count} figures, {len(notes)} footnotes', file=sys.stderr)
