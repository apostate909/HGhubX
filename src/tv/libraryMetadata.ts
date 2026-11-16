import { api } from "../api";
import { hydrateLibraryContent } from "./library";
import type { TvContent } from "./model";
import { detailContent } from "./player/content";
import { indexMetadata } from "./search/catalog";

// Shared by the history shelf and library grid. In-flight work holds its slot
// until completion, including after a route/source change.
let active = 0, generation = 0;
const queue: (() => void)[] = [];
window.addEventListener("hg:line-changed", () => { generation++; });
window.addEventListener("hg:proxy-changed", () => { generation++; });
function pump() { while (active < 2 && queue.length) queue.shift()!(); }

export function loadLibraryMetadata(content: TvContent, source: string, isCurrent: () => boolean): Promise<void> {
  const token = generation;
  const current = () => token === generation && isCurrent() && !document.hidden;
  return new Promise((resolve, reject) => {
    queue.push(() => {
      active++;
      void (async () => {
        if (!current()) return;
        const value = content.kind === "video" ? await api.video(content.id) : await api.post(content.id);
        if (!current()) return;
        if (value.id !== content.id || !value.title?.trim()) throw new Error("影片信息暂未加载，请重试");
        const metadata = detailContent(content, value);
        const saved = await hydrateLibraryContent(metadata, current);
        if (saved && current()) void indexMetadata(source, [metadata]).catch(() => {});
      })().then(resolve, reject).finally(() => { active--; pump(); });
    });
    pump();
  });
}
