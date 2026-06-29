import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { FileArchive, FileCheck2, HelpCircle, Play, RotateCcw, UploadCloud } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { parseEvernoteExportFiles, type EvernoteImportNotebook } from "@/lib/evernote-import";

type ImportPhase = "idle" | "planned" | "importing" | "awaiting-confirmation" | "done" | "error";

type ImportedNotebookSummary = {
  name: string;
  createdCount: number;
};

const EvernoteImportGuideDialog = () => (
  <Dialog>
    <DialogTrigger asChild>
      <Button size="sm" variant="outline" className="h-7 bg-white px-2.5 text-xs" type="button">
        <HelpCircle className="h-3.5 w-3.5" />
        操作指引
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[82vh] max-w-3xl gap-4 overflow-hidden p-0">
      <DialogHeader className="border-b border-slate-100 px-5 py-4">
        <DialogTitle className="text-base">从印象笔记迁移到 EdgeEver</DialogTitle>
        <DialogDescription className="leading-5">
          EdgeEver 只支持开放、可读取的 ENEX 文件；不直接支持印象笔记新版客户端导出的 .notes 文件。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5 overflow-y-auto px-5 pb-5 text-sm leading-6 text-slate-700">
        <GuideSection title="准备 ENEX 文件">
          <p>如果印象笔记客户端仍能直接导出 ENEX，可以按笔记本分别导出 .enex 文件。</p>
          <p>如果客户端只能导出 .notes，可以参考第三方命令行工具 evernote-backup 先导出 ENEX：</p>
          <pre className="overflow-x-auto rounded-md border border-slate-100 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
            <code>{`pipx install evernote-backup
evernote-backup init-db --backend china
evernote-backup sync
evernote-backup export ./edgeever-import`}</code>
          </pre>
          <ul className="list-disc space-y-1 pl-5">
            <li><code>--backend china</code> 用于连接印象笔记中国版。</li>
            <li><code>sync</code> 会把账号里的笔记同步到本地数据库。</li>
            <li><code>export ./edgeever-import</code> 会导出 ENEX 文件。</li>
            <li>evernote-backup 默认会按笔记本导出，一个笔记本对应一个 .enex 文件。</li>
          </ul>
        </GuideSection>

        <GuideSection title="在 Web 应用中导入">
          <ol className="list-decimal space-y-1 pl-5">
            <li>在电脑浏览器中打开 EdgeEver。</li>
            <li>进入左侧“个人中心 / 我的”。</li>
            <li>找到“导入印象笔记”。</li>
            <li>选择一个或多个 .enex 文件。</li>
            <li>检查导入计划中的笔记本数量和笔记数量。</li>
            <li>点击“开始导入”。</li>
            <li>每导完一个笔记本，先在 EdgeEver 中检查结果，再点击“确认结果，继续下一个”。</li>
          </ol>
          <p>移动端不开放导入入口。ENEX 文件通常较大，逐笔记本确认也更适合 PC 操作。</p>
        </GuideSection>

        <GuideSection title="时间校验">
          <p>EdgeEver 会强制保留印象笔记原始创建时间和修改时间：</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>如果 ENEX 中某条笔记缺少合法的创建时间或修改时间，导入会停止。</li>
            <li>如果 EdgeEver 创建后的 <code>createdAt</code> 或 <code>updatedAt</code> 与 ENEX 原始时间不一致，导入会停止并显示对应笔记标题。</li>
          </ul>
        </GuideSection>

        <GuideSection title="命令行导入">
          <p>命令行脚本适合自托管管理员、开发者和需要批处理的高级用户。普通产品用户优先使用 Web 导入入口。</p>
          <pre className="overflow-x-auto rounded-md border border-slate-100 bg-slate-950 p-3 text-xs leading-5 text-slate-100">
            <code>{`bun run cli -- profile set prod --url https://你的域名 --token <api-token>
bun run import:evernote -- --profile prod --input ./edgeever-import --dry-run
bun run import:evernote -- --profile prod --input ./edgeever-import`}</code>
          </pre>
          <p>API Token 至少需要 <code>read:notebooks</code>、<code>write:notebooks</code>、<code>write:memos</code>。</p>
        </GuideSection>

        <GuideSection title="常见问题">
          <GuideFaq
            question="EdgeEver 为什么不直接支持 .notes？"
            answer="印象笔记新版 .notes 文件可能包含 encoding=&quot;base64:aes&quot; 加密内容。EdgeEver 无法可靠读取和校验这类文件，因此产品层面只承诺支持 ENEX。"
          />
          <GuideFaq
            question="附件和图片会怎样？"
            answer="当前导入主要迁移文本内容、标题、标签和时间。ENEX 中的图片和附件会被转换成 evernote-resource:<hash> 形式的占位链接，便于后续定位原始资源。"
          />
          <GuideFaq
            question="笔记格式会完全一致吗？"
            answer="不会完全一致。工具会把印象笔记的 XHTML 内容转换为 Markdown，再交给 EdgeEver 保存。常规标题、段落、列表、代码块、链接和待办项会尽量保留；复杂表格、加密块、特殊样式和附件需要迁移后抽查。"
          />
        </GuideSection>
      </div>
    </DialogContent>
  </Dialog>
);

const GuideSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h3 className="text-sm font-bold text-slate-950">{title}</h3>
    {children}
  </section>
);

const GuideFaq = ({ question, answer }: { question: string; answer: string }) => (
  <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
    <div className="text-sm font-bold text-slate-900">{question}</div>
    <p className="mt-1 text-sm leading-6 text-slate-600">{answer}</p>
  </div>
);

export const EvernoteImportCard = () => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [notebooks, setNotebooks] = useState<EvernoteImportNotebook[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentMemoIndex, setCurrentMemoIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedNotebookSummary[]>([]);

  const totalNotes = useMemo(
    () => notebooks.reduce((sum, notebook) => sum + notebook.notes.length, 0),
    [notebooks]
  );
  const currentNotebook = notebooks[currentIndex] ?? null;
  const importedNoteCount = imported.reduce((sum, item) => sum + item.createdCount, 0);
  const progressLabel =
    phase === "importing" && currentNotebook
      ? `${currentNotebook.name}：${currentMemoIndex}/${currentNotebook.notes.length}`
      : imported.length > 0
        ? `已导入 ${importedNoteCount}/${totalNotes} 条笔记`
        : "等待选择导出文件";

  const handleFilesChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setError(null);
    setImported([]);
    setCurrentIndex(0);
    setCurrentMemoIndex(0);

    try {
      const parsed = await parseEvernoteExportFiles(files);

      if (parsed.length === 0) {
        throw new Error("请选择 .enex 文件。");
      }

      setNotebooks(parsed);
      setPhase("planned");
    } catch (parseError) {
      setNotebooks([]);
      setPhase("error");
      setError(parseError instanceof Error ? parseError.message : "解析印象笔记导出文件失败。");
    }
  };

  const reset = () => {
    setPhase("idle");
    setNotebooks([]);
    setCurrentIndex(0);
    setCurrentMemoIndex(0);
    setError(null);
    setImported([]);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const importNotebook = async (index: number) => {
    const notebook = notebooks[index];

    if (!notebook) {
      return;
    }

    setPhase("importing");
    setError(null);
    setCurrentIndex(index);
    setCurrentMemoIndex(0);

    try {
      const existingNotebooks = (await api.listNotebooks()).notebooks;
      const targetNotebook =
        existingNotebooks.find((item) => item.parentId === null && item.name === notebook.name) ??
        (await api.createNotebook({ name: notebook.name, parentId: null })).notebook;
      let createdCount = 0;

      for (const note of notebook.notes) {
        const result = await api.createMemo({
          notebookId: targetNotebook.id,
          title: note.title,
          contentMarkdown: note.markdown,
          tags: note.tags,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });

        if (result.memo.createdAt !== note.createdAt || result.memo.updatedAt !== note.updatedAt) {
          throw new Error(`「${note.title}」导入后的创建时间或修改时间与印象笔记原始时间不一致。`);
        }

        createdCount += 1;
        setCurrentMemoIndex(createdCount);
      }

      setImported((items) => [...items, { name: notebook.name, createdCount }]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notebooks"] }),
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
      ]);
      setPhase(index < notebooks.length - 1 ? "awaiting-confirmation" : "done");
    } catch (importError) {
      setPhase("error");
      setError(importError instanceof Error ? importError.message : "导入失败。");
    }
  };

  const continueImport = () => {
    void importNotebook(currentIndex + 1);
  };

  return (
    <Card className="hidden w-full min-w-0 overflow-hidden shadow-none lg:block">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UploadCloud className="h-4 w-4 text-emerald-700" />
          导入印象笔记
          <EvernoteImportGuideDialog />
        </CardTitle>
        <CardDescription className="text-xs leading-4">
          按笔记本选择 .enex 文件，EdgeEver 会逐个笔记本导入并保留原始创建、修改时间。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700">
            <FileArchive className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-900">{progressLabel}</div>
            <div className="mt-0.5 truncate text-xs font-medium text-slate-500">
              每个文件会作为一个同名根笔记本导入，导完一个后需要确认再继续。
            </div>
          </div>
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".enex"
            multiple
            onChange={(event) => void handleFilesChange(event)}
          />
          <Button
            size="md"
            variant="outline"
            className="h-9 shrink-0 bg-white"
            type="button"
            disabled={phase === "importing"}
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud className="h-4 w-4" />
            选择文件
          </Button>
        </div>

        {notebooks.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <div className="grid grid-cols-[1fr_7rem] bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              <span>笔记本</span>
              <span className="text-right">笔记数</span>
            </div>
            <div className="max-h-52 overflow-auto">
              {notebooks.map((notebook, index) => {
                const state =
                  imported[index] ? "done" : index === currentIndex && phase === "importing" ? "importing" : "pending";

                return (
                  <div
                    key={`${notebook.fileName}-${index}`}
                    className="grid min-h-10 grid-cols-[1fr_7rem] items-center border-t border-slate-100 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-semibold text-slate-800" title={notebook.fileName}>
                      {state === "done" && <FileCheck2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />}
                      {notebook.name}
                    </span>
                    <span
                      className={cn(
                        "text-right text-xs font-bold",
                        state === "done" ? "text-emerald-700" : state === "importing" ? "text-slate-900" : "text-slate-500"
                      )}
                    >
                      {notebook.notes.length}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {(phase === "planned" || phase === "error" || phase === "done" || phase === "awaiting-confirmation") && notebooks.length > 0 && (
            <Button size="md" variant="ghost" className="h-9" type="button" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              重新选择
            </Button>
          )}
          {phase === "planned" && (
            <Button
              size="md"
              variant="solid"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              type="button"
              onClick={() => void importNotebook(0)}
            >
              <Play className="h-4 w-4" />
              开始导入
            </Button>
          )}
          {phase === "awaiting-confirmation" && (
            <Button
              size="md"
              variant="solid"
              className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
              type="button"
              onClick={continueImport}
            >
              <Play className="h-4 w-4" />
              确认结果，继续下一个
            </Button>
          )}
          {phase === "importing" && (
            <Button size="md" variant="outline" className="h-9 bg-white" type="button" disabled>
              正在导入
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
