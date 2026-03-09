/**
 * git-ops.js — Layer 1 Handler: Git 操作
 * 
 * 零 token 的 git commit + push，不經 Kiro IDE。
 * 
 * Params:
 *   message (required) — commit message
 *   push (optional, default: true) — 是否 push
 *   branch (optional) — 指定 branch（不指定就用當前 branch）
 *   addAll (optional, default: true) — 是否 git add -A
 */

const { execSync } = require('child_process');
const path = require('path');

/**
 * Validate branch name to prevent command injection.
 * Only allows alphanumeric, dash, underscore, slash, and dot.
 * @param {string} name
 * @returns {string} validated branch name
 */
function validateBranchName(name) {
  if (!name || typeof name !== 'string') throw new Error('Invalid branch name');
  // Git branch names: alphanumeric, dash, underscore, slash, dot — no spaces or shell metacharacters
  if (!/^[a-zA-Z0-9._\/-]+$/.test(name)) {
    throw new Error(`Invalid branch name: "${name}" — only alphanumeric, dash, underscore, slash, dot allowed`);
  }
  // Prevent .. traversal in branch names
  if (name.includes('..')) {
    throw new Error(`Invalid branch name: "${name}" — ".." not allowed`);
  }
  return name;
}

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 30000 }).trim();
}

module.exports = {
  name: 'git-ops',
  description: 'Git operations（零 token）— commit-push or pull',
  type: 'layer1',

  execute: async (params) => {
    const { operation = 'commit-push', cwd: customCwd } = params;
    // Only allow cwd within the project directory to prevent path traversal
    const projectRoot = path.join(__dirname, '..', '..', '..');
    let cwd = projectRoot;
    if (customCwd) {
      const resolved = path.resolve(customCwd);
      if (!resolved.startsWith(path.resolve(projectRoot))) {
        throw new Error(`cwd must be within project directory`);
      }
      cwd = resolved;
    }

    // --- pull ---
    if (operation === 'pull') {
      try {
        const output = git('pull', cwd);
        return { success: true, message: output, outputPath: null };
      } catch (err) {
        return { success: false, message: `Pull failed: ${err.message}`, outputPath: null };
      }
    }

    // --- merge ---
    if (operation === 'merge') {
      const { branch: mergeBranch, deleteBranch = true } = params;
      if (!mergeBranch) throw new Error('Missing required param: branch');
      const safeMergeBranch = validateBranchName(mergeBranch);
      try {
        // Ensure we're on main
        const current = git('branch --show-current', cwd);
        if (current !== 'main') {
          git('checkout main', cwd);
        }
        // Fetch latest (Worker pushed to remote, Commander may not have it locally)
        git('fetch origin', cwd);
        // Pull latest main first
        try { git('pull origin main', cwd); } catch { /* ignore if no remote changes */ }
        // Merge the remote branch (Commander doesn't have local copy)
        let mergeOutput;
        try {
          mergeOutput = git(`merge origin/${safeMergeBranch} --no-ff -m "Merge ${safeMergeBranch}"`, cwd);
        } catch (mergeErr) {
          // Merge conflict — try rebase approach
          console.log(`[git-ops] Direct merge failed, trying rebase approach...`);
          try { git('merge --abort', cwd); } catch { /* ignore */ }

          // Create a local branch from the remote worker branch, rebase onto main, then merge
          const tempBranch = `rebase-${safeMergeBranch.replace(/\//g, '-')}`;
          try {
            // Clean up any leftover temp branch
            try { git(`branch -D ${tempBranch}`, cwd); } catch { /* ignore */ }
            // Create temp branch from remote worker branch
            git(`checkout -b ${tempBranch} origin/${safeMergeBranch}`, cwd);
            // Rebase onto main
            git('rebase main', cwd);
            // Switch back to main and merge (now it's fast-forwardable or clean)
            git('checkout main', cwd);
            mergeOutput = git(`merge ${tempBranch} --no-ff -m "Merge ${safeMergeBranch}"`, cwd);
            // Clean up temp branch
            try { git(`branch -D ${tempBranch}`, cwd); } catch { /* ignore */ }
          } catch (rebaseErr) {
            // Rebase also failed — abort everything and report
            try { git('rebase --abort', cwd); } catch { /* ignore */ }
            try { git('checkout main', cwd); } catch { /* ignore */ }
            try { git(`branch -D ${tempBranch}`, cwd); } catch { /* ignore */ }
            return { success: false, message: `Merge failed (rebase also failed): ${rebaseErr.message}`, outputPath: null };
          }
        }
        const results = [`Merged origin/${safeMergeBranch} into main`, mergeOutput];
        // Push
        git('push origin main', cwd);
        results.push('Pushed to origin/main');
        // Delete remote branch
        if (deleteBranch) {
          try { git(`push origin --delete ${safeMergeBranch}`, cwd); } catch { /* ignore */ }
          results.push(`Deleted remote branch ${safeMergeBranch}`);
        }
        return { success: true, message: results.join('\n'), outputPath: null };
      } catch (err) {
        // Abort merge if conflict
        try { git('merge --abort', cwd); } catch { /* ignore */ }
        return { success: false, message: `Merge failed: ${err.message}`, outputPath: null };
      }
    }

    // --- commit-push (default) ---
    const { message, push = true, branch, addAll = true } = params;
    if (!message) throw new Error('Missing required param: message');

    const results = [];

    // Switch branch if specified
    if (branch) {
      const safeBranch = validateBranchName(branch);
      const current = git('branch --show-current', cwd);
      if (current !== safeBranch) {
        // Check if branch exists
        try {
          git(`rev-parse --verify ${safeBranch}`, cwd);
          git(`checkout ${safeBranch}`, cwd);
        } catch {
          git(`checkout -b ${safeBranch}`, cwd);
        }
        results.push(`Switched to branch: ${safeBranch}`);
      }
    }

    // Check status
    const status = git('status --porcelain', cwd);
    if (!status) {
      return {
        success: true,
        message: 'Nothing to commit, working tree clean',
        outputPath: null,
      };
    }

    // Add
    if (addAll) {
      git('add -A', cwd);
      results.push('git add -A');
    }

    // Commit
    // Escape shell-sensitive characters in commit message
    const safeMsg = message.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    git(`commit -m "${safeMsg}"`, cwd);
    const hash = git('rev-parse --short HEAD', cwd);
    results.push(`Committed: ${hash} ${message}`);

    // Push
    if (push) {
      const currentBranch = git('branch --show-current', cwd);
      try {
        git(`push origin ${currentBranch}`, cwd);
        results.push(`Pushed to origin/${currentBranch}`);
      } catch (err) {
        results.push(`Push failed: ${err.message}`);
        return {
          success: false,
          message: results.join('\n'),
          outputPath: null,
          commitHash: hash,
        };
      }
    }

    return {
      success: true,
      message: results.join('\n'),
      outputPath: null,
      commitHash: hash,
    };
  },
};
