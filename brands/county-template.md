# County Template — Canva brand template EAHXjnXVuYU

The team's county ad template: https://www.canva.com/brand/brand-templates/EAHXjnXVuYU
**Process:** keep the layout and all copy exactly the same. Change only the **county name** and the **colors**. One design per county.

## The design ("MTG - County Template")
Square Mortgage Protection ad on a dark, blurred house photo. Top line: the county, in big white all caps (the `county` field, shown as {{COUNTY}} in the template). Under it, the "MORTGAGE PROTECTION" headline in neon green. Below that: a "FOR LOCAL RESIDENTS" ribbon, a two-line body, three check-mark benefits, "Tap Your Age to See if you Qualify" and the age buttons 20-39 / 40-59 / 60-79. The county goes in ALL CAPS (e.g. "HARRIS COUNTY"). Long names (e.g. "SAN BERNARDINO COUNTY") may wrap or shrink, so mention them so someone checks the layout.

## Color variants
The colors in this design are text and shape colors (headline, ribbon, checks, age buttons), which the API can't change. So each color scheme is its own published brand template named "MTG - County Template - <Color>" (e.g. "- Blue", "- Red"). The original green one may have no suffix. To pick colors, list brand templates, find every "MTG - County Template…" variant, and use the one that matches the requested color. If none is requested, rotate through the variants across a batch so neighboring counties differ. If a requested color has no variant, say which colors exist. If there's only one variant, run it and say the colors stay as designed.

## How to run it
1. Original (green) template ID: `EAHXjnXVuYU`. Find the color variants with canva_list_brand_templates. Call canva_get_template_fields on the chosen one.
2. Map the fields:
   - The text field for the county (named like "county" / "county_name"): the county exactly as given, in the template's style (e.g. "Harris County" if the original says "… County"; keep the original's casing).
   - If a variant does have image fields for color blocks (named like "color", "bg", "color_1"…), fill them with `{ "color": "#HEX" }` (optionally `"gradient_to"`) in that variant's palette.
   - Leave every other field alone. Don't rewrite copy unless asked.
3. **Colors:** pick the variant per the section above, and say which color each county got.
4. Run canva_autofill per variant, one entry per county (title: "<County> County — MTG <Color>"), up to 25 per call. Share every edit link, and offer to export PNGs (canva_export) or resize.
5. Before a big batch (over 5 counties), confirm the field mapping and palettes once.

## Limits to explain if they come up
- Canva's API can only recolor parts of the template that are set up as **image** data fields. Text colors and plain shapes keep the template's colors. If they need those changed too, the fix is in Canva: make the colored shapes image frames connected as data fields, or keep one brand template per color scheme.
- If canva_get_template_fields shows no color/image fields, tell them colors will stay as designed and explain the setup above.
