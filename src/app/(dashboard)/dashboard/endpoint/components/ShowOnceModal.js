"use client";

import { Modal, Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * The one-time show-once reveal — for a freshly created or rotated key. This
 * is the only surface that ever renders the full key: the server yields it
 * once (201 / rotate), the browser vault keeps a copy, and the user must
 * acknowledge before the modal closes. Vela itself stores only the hash.
 */
export default function ShowOnceModal({ title, secret, copied, onCopy, acked, onAck, onClose }) {
  if (!secret) return null;
  return (
    <Modal isOpen title={translate(title)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
            {translate("Save this key now!")}
          </p>
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {translate("This is the only time this key will ever be shown. Vela stores only its hash — if you lose it, create a new key and delete this one.")}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input value={secret} readOnly className="flex-1 font-mono text-sm" />
          <Button
            variant="secondary"
            icon={copied ? "check" : "content_copy"}
            onClick={() => onCopy(secret)}
          >
            {copied ? translate("Copied!") : translate("Copy")}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => onAck(e.target.checked)}
            className="accent-primary"
          />
          {translate("I have saved this key in a secure location")}
        </label>
        <Button onClick={onClose} fullWidth disabled={!acked}>
          {translate("Done")}
        </Button>
      </div>
    </Modal>
  );
}
