# Agent instructions: industry names (paste at the end of the ScraperX agent's instructions)

Produced for v0.36.0. The list at the end is made with the **Copy RTS industry list** button in the extension panel
(open a profile in RTS, press the button, paste the result under "THE COMPLETE RTS INDUSTRY LIST").

```
INDUSTRY NAMES — EXACT RTS WORDING (mandatory)

The industry is written into PitchBook RTS by an automation that finds the choice by its NAME.
If the name is not exactly an RTS name, the tagging FAILS. Therefore:

1. THE NAME IS WHAT MATTERS. Write the industry name exactly as it is printed in the RTS list below: same words, same
   capital letters, same punctuation, same suffix such as "(B2B)" or "(B2C)", same "&" and "/".
   Never invent, shorten, translate, reword or "improve" a name.
   Wrong:  "Other Services (Non-Financial)"      (not an RTS name)
   Right:  a name copied from the list below, for example "Consulting Services (B2B)".

2. CHOOSE ONLY FROM THE LIST BELOW. If you cannot point to the exact line, do not use that name. Before answering, check
   primary_industry_code and every secondary_industry_codes entry against the list, and replace any name that is not on
   the list with one that is.

3. B2B / B2C: where the list has both a (B2B) and a (B2C) version of a name, choose the one that matches the buyer type
   you established in industry_classification.buyer_type. Never drop the suffix.

4. THE GROUP. Each list line is "Group > Segment > Name  (code)". Write in "group" everything BEFORE the name on the line
   you chose (for example "Business Products and Services (B2B) > Commercial Services (B2B)"). This tells apart names
   that appear in several places, such as "Other".

5. WHEN NOTHING FITS EXACTLY: never make up a name. Choose the closest "Other ..." line that IS in the list and explain in
   industry_classification.logic and .confidence_rationale why. If even that is impossible, write
   "Not defined in methodology." for "name" and for "number".

6. THE CODE IS ONLY A LABEL. Copy the code printed at the end of the line, but if the code and the name ever disagree,
   the NAME is the one that must be right.

7. This changes only how the industry is WRITTEN. It does not change how you research, which industry you conclude fits,
   the prohibited and secondary-only rules (codes 1.4.4, 2.6.3, 2.9.1, 6.1.7, 6.2.2, 6.4.3 and 6.5.16 are never used;
   6.5.15, 2.1.4 and 2.4.5 are only ever secondary), or any other rule.

FORMAT (same keys as before, plus "group"):
"primary_industry_code": { "number": "<code>", "name": "<exact RTS name>", "group": "<everything before the name on the line>" }
"secondary_industry_codes": [ { "number": "<code>", "name": "<exact RTS name>", "group": "<...>", "evidence": { ... } } ]

THE COMPLETE RTS INDUSTRY LIST
<paste the lines copied with the "Copy RTS industry list" button here, one line per choice>
```
