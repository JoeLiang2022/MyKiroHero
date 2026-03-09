/**
 * Task Template System
 *
 * Loads JSON templates from this directory and provides:
 *   - getTemplate(name) — returns a template object or null
 *   - listTemplates() — returns array of template names
 *   - renderPrompt(templateName, params) — renders a prompt string from template + params
 *
 * Template variables use mustache-style {{var}} syntax.
 * Conditional sections use {{#var}}...{{/var}} (included only when var is truthy).
 */

const fs = require('fs');
const path = require('path');

const templates = new Map();

// Load all .json templates from this directory
const dir = __dirname;
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith('.json')) continue;
  try {
    const tpl = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (tpl.name && tpl.promptTemplate) {
      templates.set(tpl.name, tpl);
    }
  } catch (err) {
    console.error(`[TaskTemplates] Failed to load ${file}: ${err.message}`);
  }
}

/**
 * Get a template by name.
 * @param {string} name — template name (e.g. 'bug-fix')
 * @returns {object|null} template object or null if not found
 */
function getTemplate(name) {
  return templates.get(name) || null;
}

/**
 * List all loaded template names.
 * @returns {string[]}
 */
function listTemplates() {
  return Array.from(templates.keys());
}

/**
 * Render a prompt from a template.
 *
 * Replaces {{var}} with params[var].
 * Conditional blocks {{#var}}content{{/var}} are included only when params[var] is truthy.
 * Arrays in params are joined with ', '.
 *
 * @param {string} templateName — template name
 * @param {object} params — must include taskId; other fields per template
 * @returns {string} rendered prompt
 * @throws {Error} if template not found or required fields missing
 */
function renderPrompt(templateName, params) {
  const tpl = templates.get(templateName);
  if (!tpl) throw new Error(`Template not found: ${templateName}`);

  // Validate required fields
  const missing = (tpl.requiredFields || []).filter(f => !params[f]);
  if (missing.length > 0) {
    throw new Error(`Missing required fields for template '${templateName}': ${missing.join(', ')}`);
  }

  let prompt = tpl.promptTemplate;

  // Process conditional sections: {{#key}}...{{/key}}
  prompt = prompt.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return params[key] ? content : '';
  });

  // Replace simple variables: {{key}}
  prompt = prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = params[key];
    if (val == null) return '';
    return Array.isArray(val) ? val.join(', ') : String(val);
  });

  // Clean up extra blank lines from removed conditional sections
  prompt = prompt.replace(/\n{3,}/g, '\n\n').trim();

  return prompt;
}

module.exports = { getTemplate, listTemplates, renderPrompt };
