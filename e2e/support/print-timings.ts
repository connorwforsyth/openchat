import { readTimings } from "./timings";

// Playwright's global teardown: the D27 timings from the whole run, together.

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export default async function printTimings() {
  const timings = await readTimings();
  if (timings.length === 0) {
    return;
  }
  const metrics = [...new Set(timings.map((timing) => timing.metric))];
  const lines = metrics.map((metric) => {
    const samples = timings.filter((timing) => timing.metric === metric);
    const values = samples.map((sample) => sample.ms);
    return `  ${metric.padEnd(16)} median ${median(values)} ms  (${values.join(", ")} ms over ${samples.map((sample) => sample.where).join(", ")})`;
  });
  console.log(
    `\nD27 timings (production build, local):\n${lines.join("\n")}\n`
  );
}
