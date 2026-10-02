import {
  type GenerateImageOutput,
  generateImageInputSchema,
  generateImageModelText,
  generateImageOutputSchema,
  type ImagePorts,
  runGenerateImage,
} from "../image-generation";
import { defineTool, type ToolContext } from "./define";

// `generate_image` (138): draws 1–4 images with the instance's image model
// (`models.image`), or edits one from the workspace, and saves each as a
// workspace file and an `image` artifact. What it does is in
// `../image-generation.ts`; the server binds the ports per run.

export const GENERATE_IMAGE_TOOL = "generate_image";

export const generateImageTool = defineTool({
  // An image costs more than a reply, so a call asks first unless the
  // instance sets `models.image.approval: auto`.
  approval: "ask",
  capability: "images",
  description:
    "Make an image (or up to four) from a description, or edit an image in the workspace by passing its path as `source`. Use it when the user asks for a picture, illustration, photo, logo or diagram drawn as an image. Each image is shown in the reply, saved in the workspace under images/, and kept as an artifact.",
  execute: (
    input,
    { ports, signal }: ToolContext<{ readonly ports: ImagePorts }>
  ) => runGenerateImage(ports, input, signal),
  input: generateImageInputSchema,
  modelText: (output: GenerateImageOutput) => generateImageModelText(output),
  name: GENERATE_IMAGE_TOOL,
  output: generateImageOutputSchema,
});
