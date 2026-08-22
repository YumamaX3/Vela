/**
 * fallbackRules repo - SQLite harbor (Seam 2 of Resilience Covenant)
 * 
 * Operator-configurable fallback rules for combo expansion.
 * Source model → target model mappings with priority and trigger conditions.
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
  
  return db.prepare(sql).all();
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
  
  return db.prepare(sql).get(id);
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
  
  return db.prepare(sql).all(globPattern);
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
  
  const stmt = db.prepare(sql);
  const info = stmt.run(sourceModel, targetModel, priority, triggerOnStatus, maxRetries, nowIso, nowIso);
  
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
  db.prepare(sql).run(...values);
  
  return getFallbackRuleById(db, id);
}

/**
 * Delete a rule (soft delete via isActive flag)
 */
export function deleteFallbackRule(db, id) {
  const sql = `UPDATE ${TABLE} SET isActive = 0, updatedAt = ? WHERE id = ?`;
  db.prepare(sql).run(new Date().toISOString(), id);
  
  // Verify deletion
  return !getFallbackRuleById(db, id)?.isActive;
}

/**
 * Hard delete (for admin/migration purposes)
 */
export function hardDeleteFallbackRule(db, id) {
  const sql = `DELETE FROM ${TABLE} WHERE id = ?`;
  const stmt = db.prepare(sql);
  const info = stmt.run(id);
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
