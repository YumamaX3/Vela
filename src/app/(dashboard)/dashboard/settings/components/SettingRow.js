"use client";
// SettingRow — "what this is" on the left, "the control" on the right.
//
// The old room repeated this shape a dozen times by hand, and the hand-written
// copies disagreed with each other on breakpoints, alignment and description
// size. One primitive means every row in the room aligns to the same axis.
//
// `items-start` rather than `items-center`: a description that wraps to two
// lines must not shove a Toggle off the optical centre of a single-line row, and
// centring is what makes two rows of different copy length look ragged.
export default function SettingRow({ label, description, control, children, className }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className || ""}`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-text-main">{label}</p>
        {description && (
          <p className="text-sm text-text-muted mt-0.5">{description}</p>
        )}
      </div>
      {control && <div className="shrink-0 flex items-center">{control}</div>}
      {children}
    </div>
  );
}
