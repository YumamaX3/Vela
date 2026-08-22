/**
 * fallbackRules repo - SQLite harbor (Seam 2 of Resilience Covenant)
 *
 * Operator-configurable fallback rules for combo expansion.
 * Source model → target model mappings with priority and trigger conditions.
 *
 * ADAPTER CONTRACT (v0.9.20 lesson): this repo must ONLY use the portable
 * surface — db.all / db.get / db.run — never raw db.prepare(). The mirror
 * decorator, the mysql twin, and the sql.js fallback driver expose no public
 * .prepare(); a bare db.prepare(...) here crashes every API at boot with
 * "a.prepare is not a function" (the 0.9.19 boot storm, re-surfaced in the
 * live v0.9.21 mirror deployment).
 */

const TABLE = 'fallbackRules';

/**
 * Get all rules (optionally filtered by isActive)
 */
export function getFallbackRules(db, options = {}) {
  const { isActive = true } = options;

  const where = isActive ? 'WHERE isActive = 1' : '';
  const sql = `
    SELECT id, sourceModel, targetModel, priority, triggerOnStatus, maxRetries, isActive, createdAt, updatedAt
    FROM ${TABLE}
    ${where}
    ORDER BY priority ASC, id ASC
  `;

  return db.all(sql);
}

/**
 * Get rule by ID
 */
export function getFallbackRuleById(db, id) {
  const sql = `
    SELECT id, sourceModel, targetModel, priority, triggerOnStatus, maxRetries, isActive, createdAt, updatedAt
    FROM ${TABLE}
    WHERE id = ?
  `;

  return db.get(sql, [id]);
}

/**
 * Get rules for a specific source model (exact match or glob)
 * Glob patterns allowed: "model*" matches "modelX", "*provider" matches "Xprovider"
 */
export function getRulesForSourceModel(db, sourceModel) {
  // Simple glob-to-SQL conversion: * becomes %
  const globPattern = sourceModel.replace(/\*/g, '%');

  const sql = `
    SELECT id, sourceModel, targetModel, priority, triggerOnStatus, maxRetries, isActive, createdAt, updatedAt
    FROM ${TABLE}
    WHERE isActive = 1 AND sourceModel GLOB ?
    ORDER BY priority ASC, id ASC
  `;

  return db.all(sql, [globPattern]);
}

/**
 * Create a new rule
 */
export function createFallbackRule(db, data) {
  const { sourceModel, targetModel, priority = 100, triggerOnStatus = '429,503', maxRetries = 1 } = data;

  const nowIso = new Date().toISOString();

  const sql = `
    INSERT INTO ${TABLE} (sourceModel, targetModel, priority, triggerOnStatus, maxRetries, isActive, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `;

  const info = db.run(sql, [sourceModel, targetModel, priority, triggerOnStatus, maxRetries, nowIso, nowIso]);

  return { id: info.lastInsertRowid, ...data, priority, triggerOnStatus, maxRetries, isActive: 1, createdAt: nowIso, updatedAt: nowIso };
}

/**
 * Update an existing rule
 */
export function updateFallbackRule(db, id, updates) {
  const allowedFields = ['targetModel', 'priority', 'triggerOnStatus', 'maxRetries', 'isActive'];
  const setParts = [];
  const values = [];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setParts.push(`${field} = ?`);
      values.push(updates[field]);
    }
  }

  if (setParts.length === 0) {
    return getFallbackRuleById(db, id);
  }

  setParts.push('updatedAt = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const sql = `UPDATE ${TABLE} SET ${setParts.join(', ')} WHERE id = ?`;
  db.run(sql, values);

  return getFallbackRuleById(db, id);
}

/**
 * Delete a rule (soft delete via isActive flag)
 */
export function deleteFallbackRule(db, id) {
  const sql = `UPDATE ${TABLE} SET isActive = 0, updatedAt = ? WHERE id = ?`;
  db.run(sql, [new Date().toISOString(), id]);

  // Verify deletion
  return !getFallbackRuleById(db, id)?.isActive;
}

/**
 * Hard delete (for admin/migration purposes)
 */
export function hardDeleteFallbackRule(db, id) {
  const sql = `DELETE FROM ${TABLE} WHERE id = ?`;
  const info = db.run(sql, [id]);
  return info.changes > 0;
}

// Export complete surface per DB covenant
export default {
  getFallbackRules,
  getFallbackRuleById,
  getRulesForSourceModel,
  createFallbackRule,
  updateFallbackRule,
  deleteFallbackRule,
  hardDeleteFallbackRule,
};
