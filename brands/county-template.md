# MTG County Ads — Canva brand template EAHXjnXVuYU

The team's Mortgage Protection county ads, made from one Canva brand template: https://www.canva.com/brand/brand-templates/EAHXjnXVuYU

## The design
Square ad. The county is the top line in big neon-green caps ("GREENVILLE COUNTY"), then "MORTGAGE PROTECTION PROGRAM", a "FOR LOCAL RESIDENTS" ribbon, a two-line body, three check-mark benefits, "Tap Your Age to See if you Qualify" and the age buttons 20-39 / 40-59 / 60-79, all over a softly blurred, green-tinted background photo. Layout, copy and colors stay the same. **Only the county and the background photo change.**

## How the team organizes them (follow exactly)
- **One Canva project folder per state:** `MTG - <Full State Name>`, e.g. "MTG - South Carolina".
- **Each state run is usually 4 counties. Each county gets 3 versions** with different backgrounds, so a state is typically 12 designs.
- **Design titles:** `<NN> - <County> - <ST>`, e.g. "30 - Greenville - SC". County is without the word "County"; ST is the 2-letter state code. NN is a running number across ALL county ads and never restarts per state: continue from the highest existing number. To find it, call canva_search_designs with no query (most recent first, limit 50), and with the query " - <ST>" if needed. Take the highest leading number in titles shaped like "NN - County - ST", and start at that + 1. Say which number you started from. If you can't tell, ask before running.
- Number counties in the order the teammate listed them, with each county's versions consecutive (31, 32, 33 = Greenville v1–v3).

## How to run a state
1. Check the template: canva_get_template_fields on `EAHXjnXVuYU` (or find "MTG - County Template" with canva_list_brand_templates). Expect a text field for the county (e.g. `county`) and ideally an image field for the background (e.g. `background`).
2. Values:
   - County text field: `"<COUNTY NAME> COUNTY"` in all caps, e.g. "HORRY COUNTY". (If the template's county field already ends in "COUNTY", send just the name.)
   - Background image field, if it exists: give each of the 3 versions a different `{ "generate": "...", "aspect_ratio": "1:1" }` prompt. Use realistic photos that fit mortgage protection: a well-kept suburban home exterior with a lawn; a happy family on the porch or in front of their home; a home with an American flag on the porch; a couple holding keys at their front door; and so on. Make them regionally believable for that county (Lowcountry homes for Charleston, desert stucco for Maricopa, brick colonials for the Midwest). Use natural daylight, no text, no logos and no recognizable real people. Vary them across a county's 3 versions.
   - No background field: make 1 version per county, not 3 identical copies, and tell them that adding an image data field on the background photo unlocks the 3 versions.
3. Before running, show the plan in one short card: the folder, the numbering range and the title list. Run when they confirm, or right away if they said "go".
4. canva_autofill with `folder: "MTG - <State>"`, with one entry per design and `title` as above (max 25 per call, so one state per call).
5. Reply with the folder it's in, then each county with its version links. Offer PNG exports.

## Fix-ups
- Designs made earlier or outside a folder: canva_move_to_folder with the state folder and their IDs (find them with canva_search_designs).
- If Canva says folder permissions are missing, the designs still exist. Share the links and say an admin needs to enable folder:read and folder:write.
- If brand template permissions are missing, say an admin must enable brandtemplate:meta:read and brandtemplate:content:read in the Canva integration, then /canva disconnect and /canva connect.
