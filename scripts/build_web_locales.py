#!/usr/bin/env python3
"""Build the web edition's locale files from the Android string resources.

Run from the repo root after changing app/src/main/res/values*/strings.xml:

    python3 scripts/build_web_locales.py

Scans web/js/*.js and web/index.html for t('key') / thas('key') lookups, then
writes web/i18n/<locale>.json for English (base) and every values-* locale,
containing only the keys the web UI actually uses (plus string arrays the UI
references by name, e.g. worker_names). Android positional format specifiers
(%1$s, %1$d, %1$.2f) are converted to {1}-style placeholders understood by
js/i18n.js; %% becomes %.

Locales fall back to English at runtime for missing keys, so partial
translations are fine (the Android repo's sync_locale_strings.py keeps the
locale files complete in step with the base file).
"""
import glob
import html
import json
import os
import re

RES_DIR = "app/src/main/res"
OUT_DIR = "web/i18n"

# String arrays to carry over (indexed at runtime via I18n.arr(name)).
ARRAYS = ["worker_names"]

STR_RE = re.compile(r'<string name="([^"]+)"[^>]*>(.*?)</string>', re.S)
ARRAY_RE = re.compile(
    r'<string-array name="([^"]+)">(.*?)</string-array>', re.S)
ITEM_RE = re.compile(r"<item>(.*?)</item>", re.S)
SPEC_RE = re.compile(r"%(\d+)\$[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z]")
# Plain-substring scanner (no regex): finds t('key') / tt('key') / TT('key') /
# thas('key') / I18n.t/f('key') lookups plus data-i18n="key" attributes.
TRIGGERS = [
    "tt('", 'tt("', "TT('", 'TT("', "thas('", 'thas("',
    "I18n.t('", 'I18n.t("', "I18n.tf('", 'I18n.tf("',
    "t('", 't("', 'data-i18n="', "data-i18n='",
]


def extract_keys(text):
    found = set()
    for trig in TRIGGERS:
        idx = 0
        while True:
            i = text.find(trig, idx)
            if i < 0:
                break
            # bare t( / tt( must not follow a word char (so count('x') is skipped)
            if trig.startswith('t(') or trig.startswith('tt(') or trig.startswith('TT(') or trig.startswith('thas('):
                if i > 0 and (text[i - 1].isalnum() or text[i - 1] == '_'):
                    idx = i + 1
                    continue
            j = i + len(trig)
            k = j
            while k < len(text) and (text[k].isalnum() or text[k] == '_'):
                k += 1
            if k > j and k < len(text) and text[k] in ('\'', '"') and k - j > 1:
                found.add(text[j:k])
            idx = i + 1
    return found


# Keys assembled at runtime (blessing_<key>_name, town_building_<key>_name) can't
# be found by the literal scanner — include whole families by pattern instead.
ALL_BASE_KEYS = set()  # filled in main() before used_keys() runs

DYNAMIC_KEY_RES = [
    re.compile(r"^blessing_[a-z0-9_]+_name$"),
    re.compile(r"^town_building_[a-z0-9_]+_name$"),
]


def used_keys():
    keys = set()
    for js in glob.glob("web/js/*.js") + ["web/index.html"]:
        if js.endswith("i18n.js"):
            continue
        with open(js, encoding="utf-8") as f:
            keys |= extract_keys(f.read())
    keys |= {k for k in ALL_BASE_KEYS if any(p.match(k) for p in DYNAMIC_KEY_RES)}
    return keys


LOCALE_MAP = {  # Android folder suffix -> web locale tag
    "": "en",
    "cs": "cs", "de": "de", "es": "es", "es-rES": "es-ES", "fr": "fr",
    "ga": "ga", "in": "id", "it": "it", "ja": "ja", "lt": "lt", "nl": "nl",
    "pl": "pl", "pt-rBR": "pt-BR", "ru": "ru", "tr": "tr", "zh-rCN": "zh-CN",
}


def convert(text, formatted):
    """Android string -> web string: unescape entities, %1$s -> {1}, %% -> %."""
    text = html.unescape(text)
    text = text.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")
    text = text.replace("\\n", " ")
    if formatted:
        text = SPEC_RE.sub(lambda m: "{" + m.group(1) + "}", text)
        text = text.replace("%%", "%")
    return text.strip()


def parse_strings(path):
    out = {}
    with open(path, encoding="utf-8") as f:
        content = f.read()
    for m in STR_RE.finditer(content):
        name, body = m.group(1), m.group(2)
        # translatable="false" entries are internal only
        decl = re.search(r'<string name="%s"([^>]*)>' % re.escape(name), content)
        if decl and 'translatable="false"' in decl.group(1):
            continue
        formatted = "%$" in body or bool(SPEC_RE.search(body))
        out[name] = convert(body, formatted)
    arrays = {}
    for m in ARRAY_RE.finditer(content):
        name, body = m.group(1), m.group(2)
        if name in ARRAYS:
            arrays[name] = [html.unescape(i).replace("\\'", "'") for i in ITEM_RE.findall(body)]
    return out, arrays




def main():
    base_path = os.path.join(RES_DIR, "values/strings.xml")
    base, base_arrays = parse_strings(base_path)
    global ALL_BASE_KEYS
    ALL_BASE_KEYS = set(base)
    keys = used_keys()

    # Web-only keys (no Android counterpart) live in web/i18n/web-keys.json;
    # they ship as English in every locale until translated by hand.
    web_keys_path = os.path.join(OUT_DIR, "web-keys.json")
    web_keys = {}
    if os.path.exists(web_keys_path):
        with open(web_keys_path, encoding="utf-8") as f:
            web_keys = json.load(f)
        base.update(web_keys)

    missing = sorted(k for k in keys if k not in base)
    if missing:
        print(f"  note: {len(missing)} used key(s) missing from base strings: {missing[:10]}")

    os.makedirs(OUT_DIR, exist_ok=True)
    report = []
    for folder_suffix, locale in sorted(LOCALE_MAP.items(), key=lambda kv: kv[1] != "en"):
        path = os.path.join(RES_DIR, f"values{('-' + folder_suffix) if folder_suffix else ''}/strings.xml")
        if not os.path.exists(path):
            report.append(f"  skip (no file): {locale}")
            continue
        strings, arrays = parse_strings(path) if folder_suffix else (base, base_arrays)
        payload = {k: strings.get(k, base[k]) for k in sorted(keys) if k in base}
        # merge web-only keys (English fallback)
        for k, v in web_keys.items():
            if k in keys or k in payload:
                payload.setdefault(k, v)
        for name in ARRAYS:
            if name in base_arrays:
                payload["__array_" + name] = arrays.get(name, base_arrays[name])
        with open(os.path.join(OUT_DIR, locale + ".json"), "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        report.append(f"  wrote {locale}.json: {len(payload)} strings")
    print("\n".join(report))
    print(f"Done: {len(keys)} keys tracked from web/js. Edit web code, then re-run "
          f"this script after Android string changes.")


if __name__ == "__main__":
    main()
