"use client";

import { Button, Modal, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Bulk bar — appears when rows are selected. Pause / resume / set category /
 * export / delete, plus a "clear" escape hatch.
 */
export default function KeysBulkBar({
  count,
  onPause,
  onResume,
  onExport,
  onDelete,
  onClear,
  onSetCategory,
  showCategoryModal,
  setShowCategoryModal,
  category,
  setCategory,
  onApplyCategory,
}) {
  if (count === 0) return null;

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-3 rounded-[10px] border border-primary/30 bg-primary/5">
        <span className="text-sm font-semibold text-primary">
          {count} {translate("selected")}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" icon="pause" onClick={onPause}>
          {translate("Pause")}
        </Button>
        <Button size="sm" variant="outline" icon="play_arrow" onClick={onResume}>
          {translate("Resume")}
        </Button>
        <Button size="sm" variant="outline" icon="label" onClick={() => setShowCategoryModal(true)}>
          {translate("Category")}
        </Button>
        <Button size="sm" variant="outline" icon="file_download" onClick={onExport}>
          {translate("Export")}
        </Button>
        <Button size="sm" variant="danger" icon="delete" onClick={onDelete}>
          {translate("Delete")}
        </Button>
        <button
          onClick={onClear}
          className="p-1.5 rounded text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={translate("Clear selection")}
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>

      <Modal
        isOpen={showCategoryModal}
        title={translate("Set category")}
        onClose={() => setShowCategoryModal(false)}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{translate("Category (optional)")}</p>
          <Input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={translate("e.g. friend, hermes, others")}
          />
          <div className="flex gap-2">
            <Button
              onClick={() => {
                onApplyCategory();
                setShowCategoryModal(false);
              }}
              fullWidth
            >
              {translate("Apply")}
            </Button>
            <Button onClick={() => setShowCategoryModal(false)} variant="ghost" fullWidth>
              {translate("Cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
