import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Tab title: "π - <session name>". Re-applied after events that may reset it.
export default function (pi: ExtensionAPI) {
  // ctx/pi become stale after reload or session replacement; a delayed call must not throw.
  const apply = (ctx: { ui: { setTitle(t: string): void } }) => {
    try {
      const name = pi.getSessionName();
      ctx.ui.setTitle(name ? `π - ${name}` : "π");
    } catch {
      // stale context: ignore
    }
  };

  // pi's own title update may run after our handler, so re-apply shortly after too.
  const applyLater = (ctx: Parameters<typeof apply>[0]) => {
    apply(ctx);
    setTimeout(() => apply(ctx), 50);
  };

  pi.on("session_start", (_e, ctx) => applyLater(ctx));
  pi.on("session_info_changed", (_e, ctx) => applyLater(ctx));
  pi.on("tool_execution_end", (_e, ctx) => apply(ctx));
  pi.on("turn_end", (_e, ctx) => applyLater(ctx));
  pi.on("agent_end", (_e, ctx) => applyLater(ctx));
}
