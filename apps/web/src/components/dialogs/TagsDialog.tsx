import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tags, X, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn, formatDateTime } from "@/lib/utils";
import { AppConfirmDialog } from "./ConfirmDialogs";
import type { TagSummary } from "@edgeever/shared";

export const TagsDialog = ({ onClose }: { onClose: () => void }) => {
  const queryClient = useQueryClient();
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [editingTagValue, setEditingTagValue] = useState("");
  const [tagDeleteConfirmation, setTagDeleteConfirmation] = useState<TagSummary | null>(null);

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
  });

  const renameMutation = useMutation({
    mutationFn: ({ tag, name }: { tag: string; name: string }) => api.renameTag(tag, name),
    onSuccess: async () => {
      setEditingTagName(null);
      setEditingTagValue("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTag,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tags"] }),
        queryClient.invalidateQueries({ queryKey: ["memos"] }),
        queryClient.invalidateQueries({ queryKey: ["memo"] }),
      ]);
    },
  });

  const tags = tagsQuery.data?.tags ?? [];

  const handleRename = (tag: TagSummary) => {
    setEditingTagName(tag.name);
    setEditingTagValue(tag.name);
  };

  const handleCancelRename = () => {
    setEditingTagName(null);
    setEditingTagValue("");
  };

  const handleSubmitRename = (tag: TagSummary) => {
    const nextName = editingTagValue.trim();

    if (!nextName || nextName === tag.name || renameMutation.isPending) {
      return;
    }

    renameMutation.mutate({ tag: tag.name, name: nextName });
  };

  const handleDelete = (tag: TagSummary) => {
    setTagDeleteConfirmation(tag);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open && !tagDeleteConfirmation) onClose(); }}>
      <DialogContent className="max-w-[680px] p-0 overflow-hidden border border-slate-200 bg-white shadow-lg rounded-lg">
        <DialogHeader className="flex flex-row items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 text-left">
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-950">
              <Tags className="h-4 w-4 text-emerald-700" />
              标签
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-slate-500">
              {tags.length} tags
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tagsQuery.isLoading ? (
            <div className="px-2 py-8 text-center text-sm text-slate-500">加载中</div>
          ) : tags.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
              暂无标签
            </div>
          ) : (
            <div className="space-y-2">
              {tags.map((tag) => {
                const isEditing = editingTagName === tag.name;
                const nextName = editingTagValue.trim();

                return (
                  <div
                    key={tag.name}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2",
                      isEditing && "border-emerald-200 bg-emerald-50/30"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      {isEditing ? (
                        <form
                          className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleSubmitRename(tag);
                          }}
                        >
                          <label className="sr-only" htmlFor={`tag-rename-${tag.name}`}>
                            标签名称
                          </label>
                          <Input
                            id={`tag-rename-${tag.name}`}
                            className="h-9 min-w-0 flex-1 focus-visible:border-emerald-300 focus-visible:ring-emerald-500/20"
                            value={editingTagValue}
                            autoFocus
                            disabled={renameMutation.isPending}
                            maxLength={80}
                            onChange={(event) => setEditingTagValue(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                handleCancelRename();
                              }
                            }}
                          />
                          <div className="flex shrink-0 gap-2">
                            <Button
                              className="justify-center"
                              size="sm"
                              type="submit"
                              variant="solid"
                              disabled={!nextName || nextName === tag.name || renameMutation.isPending}
                            >
                              保存
                            </Button>
                            <Button size="sm" type="button" variant="outline" onClick={handleCancelRename} disabled={renameMutation.isPending}>
                              取消
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <span className="block truncate text-sm font-semibold text-slate-950">#{tag.name}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {tag.memoCount} 条笔记{tag.updatedAt ? ` · ${formatDateTime(tag.updatedAt)}` : ""}
                          </span>
                        </>
                      )}
                    </span>
                    {!isEditing && (
                      <>
                        <Button size="icon" variant="ghost" title="重命名标签" aria-label={`重命名标签 ${tag.name}`} onClick={() => handleRename(tag)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="danger" title="删除标签" aria-label={`删除标签 ${tag.name}`} onClick={() => handleDelete(tag)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>

      {tagDeleteConfirmation && (
        <AppConfirmDialog
          title={`删除标签 #${tagDeleteConfirmation.name}`}
          description={`将从 ${tagDeleteConfirmation.memoCount} 条笔记中移除这个标签，笔记内容不会被删除。`}
          confirmLabel="删除标签"
          isWorking={deleteMutation.isPending}
          tone="danger"
          onCancel={() => setTagDeleteConfirmation(null)}
          onConfirm={() => {
            deleteMutation.mutate(tagDeleteConfirmation.name, {
              onSuccess: () => setTagDeleteConfirmation(null),
            });
          }}
        />
      )}
    </Dialog>
  );
};
