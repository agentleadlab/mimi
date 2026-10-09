import { canva, CanvaApiError, waitForJob } from "./api.js";
import { CanvaNotConnectedError, connection, hasScope } from "./auth.js";
import { swatchPng } from "./swatch.js";
import { generateImage, geminiConfigured } from "../gemini.js";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_AUTOFILL = 25;

function summarize(design) {
  return {
    id: design.id,
    title: design.title,
    edit_url: design.urls?.edit_url,
    view_url: design.urls?.view_url,
    thumbnail_url: design.thumbnail?.url,
    page_count: design.page_count,
  };
}

/** Download an image (e.g. a Discord attachment) and upload it to Canva. Returns the asset id. */
async function uploadImage(imageUrl, name = "Mimi upload") {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:") throw new Error("Image URLs must be https.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download the image (${res.status}). Discord links expire — re-share it.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("That image is over 25 MB.");
  return uploadBytes(bytes, name);
}

async function uploadBytes(bytes, name) {
  const { job } = await canva("POST", "/v1/asset-uploads", {
    body: bytes,
    headers: {
      "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(name.slice(0, 50)).toString("base64") }),
    },
  });
  const done = job.status === "success" ? job : await waitForJob(`/v1/asset-uploads/${job.id}`);
  return done.asset.id;
}

/** Find a folder by name inside a parent ("root" = Projects), case-insensitively. */
async function findFolder(parentId, name) {
  let continuation;
  do {
    const data = await canva("GET", `/v1/folders/${encodeURIComponent(parentId)}/items`, {
      query: { item_types: "folder", continuation },
    });
    const hit = (data.items ?? []).find((i) => i.folder?.name?.trim().toLowerCase() === name.toLowerCase());
    if (hit) return hit.folder;
    continuation = data.continuation;
  } while (continuation);
  return null;
}

/** Resolve a folder path like "MTG Counties/South Carolina" under Projects, creating what's missing. */
async function ensureFolderPath(path) {
  if (!hasScope("folder:write")) {
    throw new Error(
      "Mimi's Canva connection can't manage folders (folder:read and folder:write aren't enabled). " +
        "An admin can enable them in the Canva integration's Scopes, then run /canva disconnect and /canva connect.",
    );
  }
  const parts = String(path).split("/").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Folder name is empty.");
  let parent = "root";
  let folder;
  for (const name of parts) {
    folder = await findFolder(parent, name);
    if (!folder) ({ folder } = await canva("POST", "/v1/folders", { body: { name: name.slice(0, 255), parent_folder_id: parent } }));
    parent = folder.id;
  }
  return { id: folder.id, path: `Projects / ${parts.join(" / ")}` };
}

async function moveToFolder(folderId, designIds) {
  const moved = [];
  const failed = [];
  for (const id of designIds) {
    try {
      await canva("POST", "/v1/folders/move", { body: { to_folder_id: folderId, item_id: id } });
      moved.push(id);
    } catch (err) {
      failed.push({ id, error: describeCanvaError(err) });
    }
  }
  return { moved: moved.length, ...(failed.length && { failed }) };
}

const handlers = {
  async canva_search_designs({ query, limit = 10 }) {
    const data = await canva("GET", "/v1/designs", {
      query: { query, limit: Math.min(limit, 50), sort_by: query ? "relevance" : "modified_descending" },
    });
    return { designs: data.items.map(summarize) };
  },

  async canva_create_design({ title, preset, width, height, image_url }) {
    const design_type = preset ? { type: "preset", name: preset } : { type: "custom", width, height };
    const body = { type: "type_and_asset", design_type, title };
    if (image_url) body.asset_id = await uploadImage(image_url, title);
    const { design } = await canva("POST", "/v1/designs", { body });
    return { design: summarize(design) };
  },

  async canva_list_brand_templates({ query, limit = 20 }) {
    if (connection() && !hasScope("brandtemplate:meta:read")) {
      throw new Error(
        "Mimi's Canva connection can't list brand templates (the app lacks the brandtemplate:meta:read permission). " +
          "Ask for the template's ID from its Canva link instead, or have an admin enable that permission and run /canva connect again.",
      );
    }
    const data = await canva("GET", "/v1/brand-templates", {
      query: { query, limit: Math.min(limit, 50), dataset: "non_empty" },
    });
    return {
      templates: data.items.map((t) => ({ id: t.id, title: t.title, view_url: t.view_url, thumbnail_url: t.thumbnail?.url })),
    };
  },

  async canva_get_template_fields({ brand_template_id }) {
    const { dataset } = await canva("GET", `/v1/brand-templates/${encodeURIComponent(brand_template_id)}/dataset`);
    return {
      fields: Object.entries(dataset ?? {}).map(([name, f]) => ({ name, type: f.type })),
    };
  },

  async canva_move_to_folder({ folder, design_ids }) {
    if (!Array.isArray(design_ids) || design_ids.length === 0) throw new Error("`design_ids` must be a non-empty list.");
    const target = await ensureFolderPath(folder);
    return { folder: target, ...(await moveToFolder(target.id, design_ids.slice(0, 50))) };
  },

  async canva_autofill({ brand_template_id, designs, folder }) {
    if (!Array.isArray(designs) || designs.length === 0) throw new Error("`designs` must be a non-empty list.");
    if (designs.length > MAX_AUTOFILL) throw new Error(`At most ${MAX_AUTOFILL} designs per call — split the batch.`);

    const results = [];
    // One at a time: Canva rate-limits autofill per user, and partial results are still useful.
    for (const [i, row] of designs.entries()) {
      try {
        const data = {};
        for (const [field, value] of Object.entries(row.fields ?? {})) {
          if (value && typeof value === "object" && value.image_url) {
            data[field] = { type: "image", asset_id: await uploadImage(value.image_url, field) };
          } else if (value && typeof value === "object" && value.generate) {
            if (!geminiConfigured()) throw new Error("Image generation isn't set up (GEMINI_API_KEY), so `generate` can't be used.");
            const img = await generateImage({ prompt: String(value.generate), aspectRatio: value.aspect_ratio });
            data[field] = { type: "image", asset_id: await uploadBytes(img.buffer, `${row.title ?? field}`) };
          } else if (value && typeof value === "object" && value.color) {
            const png = swatchPng(value.color, value.gradient_to);
            data[field] = { type: "image", asset_id: await uploadBytes(png, `${field} ${value.color}`) };
          } else {
            data[field] = { type: "text", text: String(value) };
          }
        }
        const { job } = await canva("POST", "/v1/autofills", {
          body: { type: "create_from_brand_template", brand_template_id, data, ...(row.title && { title: row.title }) },
        });
        const done = job.status === "success" ? job : await waitForJob(`/v1/autofills/${job.id}`);
        results.push({ row: i + 1, design: summarize(done.result.design) });
      } catch (err) {
        results.push({ row: i + 1, error: describeCanvaError(err) });
      }
    }
    if (!folder) return { results };
    const ids = results.map((r) => r.design?.id).filter(Boolean);
    if (!ids.length) return { results };
    try {
      const target = await ensureFolderPath(folder);
      return { results, folder: { ...target, ...(await moveToFolder(target.id, ids)) } };
    } catch (err) {
      return { results, folder_error: `Designs were created in Projects, but couldn't be filed: ${describeCanvaError(err)}` };
    }
  },

  async canva_resize({ design_id, sizes }) {
    if (!Array.isArray(sizes) || sizes.length === 0) throw new Error("`sizes` must be a non-empty list.");
    const results = [];
    for (const size of sizes.slice(0, 10)) {
      try {
        const { job } = await canva("POST", "/v1/resizes", {
          body: { design_id, design_type: { type: "custom", width: size.width, height: size.height } },
        });
        const done = job.status === "success" ? job : await waitForJob(`/v1/resizes/${job.id}`);
        results.push({ label: size.label, width: size.width, height: size.height, design: summarize(done.result.design) });
      } catch (err) {
        results.push({ label: size.label, width: size.width, height: size.height, error: describeCanvaError(err) });
      }
    }
    return { results };
  },

  async canva_export({ design_id, format, pages, width }) {
    const fmt = { type: format };
    if (pages?.length) fmt.pages = pages;
    if (width && (format === "png" || format === "jpg")) fmt.width = width;
    if (format === "jpg") fmt.quality = 90;
    const { job } = await canva("POST", "/v1/exports", { body: { design_id, format: fmt } });
    const done = job.status === "success" ? job : await waitForJob(`/v1/exports/${job.id}`);
    return { download_urls: done.urls, note: "Download links expire after 24 hours." };
  },
};

export function describeCanvaError(err) {
  if (err instanceof CanvaNotConnectedError) return err.message;
  if (err instanceof CanvaApiError) {
    if (err.code === "trial_quota_exceeded") return "Canva trial quota used up for this feature — it needs a paid Canva plan.";
    if (err.status === 401) return "Canva rejected the login. An admin should run /canva connect again.";
    if (err.status === 403) {
      return `Canva says this account can't do that (${err.message}). Brand templates and autofill need Canva Pro/Teams/Enterprise; resizing needs Pro or higher.`;
    }
    if (err.status === 404) return `Canva couldn't find that (${err.message}). Double-check the ID.`;
    if (err.status === 429) return "Canva rate limit hit — wait a minute and retry.";
    return `Canva error ${err.status}${err.code ? ` (${err.code})` : ""}: ${err.message}`;
  }
  return err.message ?? String(err);
}

/** Run one tool call; returns { content, isError }. */
export async function runCanvaTool(name, input) {
  const handler = handlers[name];
  if (!handler) return { content: `Unknown tool: ${name}`, isError: true };
  try {
    return { content: JSON.stringify(await handler(input ?? {})), isError: false };
  } catch (err) {
    console.error(`Canva tool ${name} failed:`, err);
    return { content: describeCanvaError(err), isError: true };
  }
}

const imageUrlProp = {
  type: "string",
  description: "https URL of an image to place in the design, e.g. an image attachment URL from the Discord conversation.",
};

export const canvaTools = [
  {
    name: "canva_search_designs",
    description: "Search the connected Canva account's designs by title/keyword, or list the most recently edited ones when no query is given.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms. Omit to list recent designs." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Max results (default 10)." },
      },
    },
  },
  {
    name: "canva_create_design",
    description:
      "Create a new blank Canva design at a given size (optionally starting with an image), and get its edit link. " +
      "Use custom width/height in pixels for social formats, e.g. Instagram post 1080x1080, Instagram/Facebook story 1080x1920, " +
      "Facebook/LinkedIn feed 1200x628, YouTube thumbnail 1280x720. Use `preset` only for doc, email, presentation or whiteboard. " +
      "The Canva API can't place text or layouts on a blank design — for finished on-brand assets, autofill a brand template instead.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Design title (1-255 chars)." },
        preset: { type: "string", enum: ["doc", "email", "presentation", "whiteboard"] },
        width: { type: "integer", minimum: 40, maximum: 8000 },
        height: { type: "integer", minimum: 40, maximum: 8000 },
        image_url: imageUrlProp,
      },
      required: ["title"],
    },
  },
  {
    name: "canva_list_brand_templates",
    description: "List the brand templates (that have autofill data fields) available to the connected Canva account. Needs Canva Pro, Teams or Enterprise.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filter by title keywords." },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: "canva_get_template_fields",
    description: "Get a brand template's autofill data fields (name and type: text, image, chart). Call before canva_autofill to map data to fields.",
    input_schema: {
      type: "object",
      properties: { brand_template_id: { type: "string" } },
      required: ["brand_template_id"],
    },
  },
  {
    name: "canva_autofill",
    description:
      `Bulk-create designs from a brand template, one design per entry in \`designs\` (max ${MAX_AUTOFILL} per call). ` +
      "Each entry maps template field names to values: a string for text fields, {\"image_url\": \"...\"} for image fields, " +
      "{\"color\": \"#HEX\", \"gradient_to\": \"#HEX\" (optional)} to fill an image field with a solid color or gradient (how to recolor a template, since autofill can't change element colors directly), " +
      "or {\"generate\": \"visual prompt\", \"aspect_ratio\": \"1:1\"} to fill an image field with a new AI image (Gemini), e.g. a fresh background per version. " +
      "Pass `folder` (e.g. \"MTG - South Carolina\", or a path \"Parent/Child\") to file the new designs into that Canva project folder, created if missing. " +
      "Returns each new design's edit link, or a per-row error.",
    input_schema: {
      type: "object",
      properties: {
        brand_template_id: { type: "string" },
        designs: {
          type: "array",
          minItems: 1,
          maxItems: MAX_AUTOFILL,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title for this design." },
              fields: {
                type: "object",
                description: "Field name -> text string, {\"image_url\": \"https://...\"}, or {\"color\": \"#HEX\"} for image fields.",
                additionalProperties: {
                  anyOf: [
                    { type: "string" },
                    { type: "object", properties: { image_url: imageUrlProp }, required: ["image_url"] },
                    {
                      type: "object",
                      properties: {
                        generate: { type: "string", description: "Visual prompt for a new AI image" },
                        aspect_ratio: { type: "string", enum: ["1:1", "4:5", "9:16", "16:9", "3:4", "4:3"] },
                      },
                      required: ["generate"],
                    },
                    {
                      type: "object",
                      properties: {
                        color: { type: "string", description: "Hex color, e.g. #0B3D91" },
                        gradient_to: { type: "string", description: "Optional second hex for a top-to-bottom gradient" },
                      },
                      required: ["color"],
                    },
                  ],
                },
              },
            },
            required: ["fields"],
          },
        },
        folder: { type: "string", description: "Canva project folder (path) to file the new designs into; created if missing." },
      },
      required: ["brand_template_id", "designs"],
    },
  },
  {
    name: "canva_move_to_folder",
    description: "Move existing designs into a Canva project folder (path like \"MTG - South Carolina\"), creating the folder if missing.",
    input_schema: {
      type: "object",
      properties: {
        folder: { type: "string" },
        design_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50 },
      },
      required: ["folder", "design_ids"],
    },
  },
  {
    name: "canva_resize",
    description:
      "Create resized copies of a design for other formats (one new design per size, max 10). Needs Canva Pro or higher. " +
      "Common sizes: Instagram post 1080x1080, portrait 1080x1350, story/reel 1080x1920, Facebook/LinkedIn feed 1200x628, X post 1600x900, YouTube thumbnail 1280x720.",
    input_schema: {
      type: "object",
      properties: {
        design_id: { type: "string" },
        sizes: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "e.g. 'Instagram story'" },
              width: { type: "integer", minimum: 40, maximum: 8000 },
              height: { type: "integer", minimum: 40, maximum: 8000 },
            },
            required: ["width", "height"],
          },
        },
      },
      required: ["design_id", "sizes"],
    },
  },
  {
    name: "canva_export",
    description: "Export a design to a downloadable file and get download links (valid 24 hours).",
    input_schema: {
      type: "object",
      properties: {
        design_id: { type: "string" },
        format: { type: "string", enum: ["png", "jpg", "pdf", "pptx", "gif", "mp4"] },
        pages: { type: "array", items: { type: "integer", minimum: 1 }, description: "1-based pages to export (default all)." },
        width: { type: "integer", minimum: 40, maximum: 25000, description: "Output width in px for png/jpg (optional)." },
      },
      required: ["design_id", "format"],
    },
  },
];
