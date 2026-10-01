// Stylesheets imported as text (`with { type: "text" }`, bun) for sites (125).
declare module "tailwindcss/index.css" {
  const text: string;
  export default text;
}
declare module "@workspace/ui/globals.css" {
  const text: string;
  export default text;
}
