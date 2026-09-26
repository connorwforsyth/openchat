export default function Page() {
  return (
    <div className="bg-zinc-950 text-white hover:bg-blue-500/80">
      <span style={{ color: "#ff0000" }}>hex</span>
      <span style={{ background: "rgb(0 0 0 / 50%)" }}>rgb</span>
      <span className="border-s-red-500 dark:text-slate-400">palette</span>
    </div>
  );
}
