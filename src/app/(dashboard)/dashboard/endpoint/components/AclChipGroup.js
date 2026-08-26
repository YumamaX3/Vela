"use client";

function AclChipGroup({ label, options, value, onToggle, noneLabel }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      {(!options || options.length === 0) ? (
        <p className="text-xs text-text-muted italic">{noneLabel}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => {
            const active = value.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => onToggle(o)}
                className={`text-[10px] px-2 py-1 rounded-full border transition-all ${
                  active
                    ? "bg-primary/15 text-primary border-primary/40 font-semibold"
                    : "bg-surface-2 text-text-muted border-border-subtle hover:text-primary hover:border-primary/40"
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AclChipGroup;