export default function Page() {
  // Tracked upstream as vercel/ai-elements#450 and in PR #123.
  return (
    <div className="bg-background text-muted-foreground hover:bg-primary/80">
      <a className="text-primary" href="#section">
        anchor
      </a>
      {/* ci-guard-ignore tokens: an anchor id, not a colour */}
      <a href="#feed">feed</a>
      <span className="ms-2 ring-ring/50 [&_svg]:size-4">&#123;</span>
    </div>
  );
}
