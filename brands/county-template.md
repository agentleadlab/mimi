# County Template — Canva brand template EAHXjnXVuYU

The team's county ad template: https://www.canva.com/brand/brand-templates/EAHXjnXVuYU
**Process:** keep the layout and all copy exactly the same. Change only the **county name** and the **colors**. One design per county.

## How to run it
1. Use brand template ID `EAHXjnXVuYU`. If Canva doesn't recognize that ID, call canva_list_brand_templates and pick the template whose link/title matches. Then call canva_get_template_fields to see its fields.
2. Map the fields:
   - The text field for the county (named like "county" / "county_name"): the county exactly as given, in the template's style (e.g. "Harris County" if the original says "… County"; keep the original's casing).
   - Every image field that's a color block (named like "color", "bg", "accent", "color_1"…): `{ "color": "#HEX" }`, or `{ "color": "#HEX", "gradient_to": "#HEX" }` if the original block is a gradient.
   - Leave every other field alone. Don't rewrite copy unless asked.
3. **Colors:** use the colors the teammate gives. If they don't give any, pick a fresh palette per county (strong, high-contrast, readable with the template's text) and say which hexes you used so they can be reused. For a batch, give each county a different palette unless told otherwise.
4. Run canva_autofill with one entry per county (title: "<County> — County Ad"), up to 25 per call. Share every edit link, and offer to export PNGs (canva_export) or resize.
5. Before a big batch (over 5 counties), confirm the field mapping and palettes once.

## Limits to explain if they come up
- Canva's API can only recolor parts of the template that are set up as **image** data fields. Text colors and plain shapes keep the template's colors. If they need those changed too, the fix is in Canva: make the colored shapes image frames connected as data fields, or keep one brand template per color scheme.
- If canva_get_template_fields shows no color/image fields, tell them colors will stay as designed and explain the setup above.
