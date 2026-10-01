// The PostCSS setup lives in @workspace/ui so every app compiles Tailwind the same way.
// biome-ignore lint/performance/noBarrelFile: PostCSS needs a config file in each app; this one only points at the shared one.
export { default } from "@workspace/ui/postcss.config";
