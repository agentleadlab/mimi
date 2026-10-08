import { ASPECT_RATIOS, describeGeminiError, generateImage } from "../gemini.js";

const MAX_IMAGES_PER_REPLY = 4;

export const imageTools = [
  {
    name: "generate_image",
    description:
      "Generate an image with Gemini (ad creatives, lifestyle photos, backgrounds, concepts, mood board frames). " +
      "Write a rich, specific visual prompt: subject, setting, lighting, camera/lens or style, mood, composition, and empty space for text if it's an ad. " +
      "Pick the aspect ratio from where it runs: feed 4:5 (1080×1350) or 1:1, Stories/Reels 9:16, YouTube/landscape 16:9. " +
      "Pass reference_image_urls (from \"[attached image: URL]\") to edit an image or match its style. " +
      "The image is attached to your reply automatically — don't paste links to it. One image per call; call again for variations.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed visual prompt." },
        aspect_ratio: { type: "string", enum: ASPECT_RATIOS },
        reference_image_urls: { type: "array", items: { type: "string" }, maxItems: 3 },
        title: { type: "string", description: "Short label for the image, e.g. 'Option A · Porch at sunset'." },
      },
      required: ["prompt"],
    },
  },
];

export const imageToolNames = new Set(imageTools.map((t) => t.name));

/**
 * Run an image tool. Generated images are pushed onto `context.files`
 * ({ name, buffer, title }) so the caller can attach them to the reply.
 */
export async function runImageTool(name, input, context = {}) {
  if (name !== "generate_image") return { content: `Unknown tool: ${name}`, isError: true };
  const files = context.files ?? [];
  if (files.length >= MAX_IMAGES_PER_REPLY) {
    return { content: `Limit of ${MAX_IMAGES_PER_REPLY} images per reply reached — offer to make more in a follow-up.`, isError: true };
  }
  try {
    const { buffer, mimeType } = await generateImage({
      prompt: String(input?.prompt ?? ""),
      aspectRatio: input?.aspect_ratio,
      referenceImageUrls: input?.reference_image_urls ?? [],
    });
    const ext = mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "png";
    const file = { name: `mimi-image-${files.length + 1}.${ext}`, buffer, title: input?.title };
    files.push(file);
    console.log(`Image generated for ${context.requester ?? "someone"} (${input?.aspect_ratio ?? "default ratio"}).`);
    return { content: `Image generated and attached as ${file.name}${input?.title ? ` ("${input.title}")` : ""}.`, isError: false };
  } catch (err) {
    console.error("generate_image failed:", err);
    return { content: describeGeminiError(err), isError: true };
  }
}
