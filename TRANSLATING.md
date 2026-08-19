# Translating Idle Fantasy

Thank you for helping translate Idle Fantasy! Translations are managed through
the project's own translation site at
**[translate.tristinbaker.xyz](https://translate.tristinbaker.xyz)** — no Git
knowledge required.

---

## How to contribute

1. Visit [translate.tristinbaker.xyz](https://translate.tristinbaker.xyz).
2. Select your language (or add a new one).
3. Fill in as many fields as you like — untranslated strings are listed first,
   grouped by file. Leave anything you don't want to touch blank.
4. If a string is already correct as-is for your language (for example a word
   identical to English, like "Bronze"), check **Correct as-is** instead of
   retyping it.
5. Click Submit. This automatically opens a pull request on GitHub with your
   changes, which is reviewed and merged like any other contribution. You can
   add your name so the PR credits you.

Partial submissions are welcome — translate one string or a hundred.

## How untranslated strings are tracked

Every language file contains every string. Anything not yet translated carries
the English text with a trailing `<!-- untranslated -->` comment, and the
files follow the exact ordering of the English files. New game strings always
arrive in English with that marker — nothing is machine-translated.

The translation site reads and removes these markers for you automatically.
If you prefer editing the XML files directly and opening PRs by hand, the
rules are: search your language's files for `untranslated` to find open work,
delete the marker together with translating the string, and delete just the
marker if the English text is already correct for your language.

---

## File structure

Strings are split into thematic files so you can focus on what you know:

| File | Contents |
|---|---|
| `strings.xml` | Core UI: buttons, labels, error messages, settings |
| `strings_notifications.xml` | Push notification titles and body text |
| `strings_skills.xml` | Skill names and descriptions |
| `strings_items.xml` | Item names and descriptions |
| `strings_quests.xml` | Quest names, descriptions, and objectives |
| `strings_guild_quests.xml` | Guild quest names and descriptions |
| `strings_weekly_quests.xml` | Weekly quest names and descriptions |
| `strings_enemies.xml` | Enemy names, dungeon names, boss names |
| `strings_game.xml` | In-game messages: level-up text, session summaries |

You do not need to translate all files — partial translations are welcome.

---

## Format arguments

Many strings contain `%1$s`, `%1$d`, `%2$s` etc. These are **positional placeholders**
that get filled in at runtime (e.g. a skill name, a number).

- **Do** keep all placeholders in your translation.
- **Do** reorder them if your language's grammar requires it (that's why they're numbered).
- **Do not** change the number or type of a placeholder (e.g. `%1$s` must stay a string).

Example:
```
English:  "Your %1$s session has finished."
French:   "Ta session de %1$s est terminée."
Japanese: "%1$sのセッションが終了しました。"
```

---

## Translator notes

Strings with `<!-- Translator note: ... -->` comments contain guidance specific to
that string — please read them before translating.

---

## Game glossary

To keep terminology consistent, please follow these translations if your language
has established equivalents for idle RPG terminology:

| English term | Notes |
|---|---|
| Session | A timed activity period (up to an hour) |
| XP / Experience | The idle RPG progression currency |
| Skill | One of the trainable skills (Mining, Fishing, etc.) |
| Dungeon | A solo combat zone |
| Boss | A powerful unique enemy at the end of a dungeon or solo encounter |
| Arena | Where the player fights NPC challengers |
| Patch | A farming plot |
| Pet | A companion animal that grants an XP bonus |

---

## Web edition

The browser port (`web/`) consumes the same translations: run

```bash
python3 scripts/build_web_locales.py
```

from the repo root to regenerate `web/i18n/<locale>.json` from the Android
string resources (plus the few web-only strings in `web/i18n/web-keys.json`).
Run it after Weblate merges or after editing `web/` code, and commit the
generated files together with your change.

---

## Questions?

Open a Q&A discussion on the project repository.
