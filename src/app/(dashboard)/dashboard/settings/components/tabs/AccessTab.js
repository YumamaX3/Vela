"use client";
// Access — who may open this dashboard, and which sessions are open right now.
//
// The old room put the require-login toggle and the password form at the top of
// a 1,710-line page and the session ledger four cards below it, so the question
// "is this door locked, and who is inside?" took a scroll to answer. They belong
// in one room, in that order: the lock first, then the ledger of holders.
//
// The blue first-time notice is kept verbatim — it is the only place the room
// explains that an empty current password is CORRECT on the very first set, and
// that remote access stays shut until a password exists.
import { useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";
import StatusLine from "../StatusLine";
import SettingRow from "../SettingRow";
import SessionsCard from "../SessionsCard";

export default function AccessTab({ deck }) {
  const { settings, loading, pending, patch } = deck;
  const requireLogin = settings.requireLogin === true;
  const hasPassword = settings.hasPassword === true;

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState(settings.username || "");
  const [status, setStatus] = useState({ type: "", message: "" });

  const toggleLogin = async (value) => {
    const r = await patch({ requireLogin: value }, ["requireLogin"]);
    if (!r.ok) setStatus({ type: "error", message: r.error });
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ type: "error", message: "Passwords do not match" });
      return;
    }
    const desired = name.trim();
    const renaming = !!desired && desired !== (settings.username || "");
    if (!next && !renaming) {
      setStatus({ type: "error", message: "Enter a new password or a new username" });
      return;
    }
    setStatus({ type: "", message: "" });
    const body = { currentPassword: current, newPassword: next };
    const keys = ["password"];
    if (renaming) {
      body.newUsername = desired;
      keys.push("username");
    }
    const r = await patch(body, keys);
    if (r.ok) {
      setStatus({ type: "success", message: renaming ? "Credential updated successfully" : "Password updated successfully" });
      setCurrent("");
      setNext("");
      setConfirm("");
      if (r.data?.username) setName(r.data.username);
    } else {
      setStatus({ type: "error", message: r.error });
    }
  };

  return (
    <>
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">lock</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Dashboard access</h3>
            <p className="text-sm text-text-muted mt-0.5">
              Whether this console asks for a password at all.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <SettingRow
            label="Require login"
            description="When ON, the dashboard requires a password. When OFF, it opens without one."
            control={
              <Toggle
                checked={requireLogin}
                onChange={() => toggleLogin(!requireLogin)}
                disabled={loading || !!pending.requireLogin}
              />
            }
          />

          {requireLogin && (
            <form onSubmit={submitPassword} className="flex flex-col gap-4 pt-4 border-t border-border-subtle">
              <div>
                <label className="text-sm font-medium text-text-main" htmlFor="access-username">Username</label>
                <Input
                  id="access-username"
                  type="text"
                  placeholder="Enter username"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="username"
                  className="mt-2"
                />
                {hasPassword && (
                  <p className="text-xs text-text-muted mt-1.5">
                    Renaming the seat requires the current password below.
                  </p>
                )}
              </div>

              {hasPassword ? (
                <div>
                  <label className="text-sm font-medium text-text-main">Current password</label>
                  <Input
                    type="password"
                    placeholder="Enter current password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    required
                    className="mt-2"
                  />
                </div>
              ) : (
                <div className="p-3 rounded-[10px] bg-brand-500/10 border border-brand-500/20">
                  <p className="text-sm text-text-main">
                    Setting your first dashboard password. Leave the current password empty.
                    Remote access stays locked until a password is set.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-text-main">New password</label>
                  <Input
                    type="password"
                    placeholder={hasPassword ? "Leave blank to keep" : "Enter new password"}
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-text-main">Confirm new password</label>
                  <Input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="mt-2"
                  />
                </div>
              </div>

              <StatusLine status={status} />

              <div className="pt-2">
                <Button type="submit" variant="primary" loading={!!pending.password} className="w-full sm:w-auto">
                  {hasPassword ? "Update Password" : "Set Password"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>

      <SessionsCard />
    </>
  );
}
