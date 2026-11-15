export default function HomePage() {
  return (
    <main className="p-8 max-w-5xl mx-auto">
      <header className="border-b border-zinc-800 pb-4 mb-8">
        <h1 className="text-xl font-bold tracking-tight text-zinc-100">HookRelay</h1>
        <p className="text-sm text-zinc-400">Event Dispatcher Engine & Webhook Delivery Console</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 border border-zinc-800 rounded bg-zinc-950">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Engine Status</span>
          <p className="text-sm font-mono mt-1 text-emerald-400">OPERATIONAL</p>
        </div>
        <div className="p-4 border border-zinc-800 rounded bg-zinc-950">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Dispatch Queue</span>
          <p className="text-sm font-mono mt-1 text-zinc-300">0 pending</p>
        </div>
        <div className="p-4 border border-zinc-800 rounded bg-zinc-950">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Circuit Breakers</span>
          <p className="text-sm font-mono mt-1 text-emerald-400">ALL CLOSED</p>
        </div>
      </div>
    </main>
  );
}
